-- 075_finance.sql — receivables and payments (a small financial control)
--
--   receivables          what a customer owes: amount, due date, optional links
--                        to the contact, company, deal and quote, how it is
--                        expected to be paid (boleto / Pix / cash) and the
--                        boleto number. Nothing here says "paid": that comes
--                        from the payments, so a part-payment is just a payment.
--   receivable_payments  what came in: amount, method (boleto / Pix / cash /
--                        other), date and a note. Cash can be flagged as
--                        deposited, so "cash on hand" is what is not yet.
--   receivable_balances  view: each receivable with paid amount, balance and
--                        status (open / partial / overdue / paid / cancelled).
--                        "Overdue" follows the Fortaleza calendar day.
--
-- Agents and above work with them; only admins delete a receivable.
-- redeem_invitation() is redefined so both tables count as data.
-- ============================================================

CREATE TABLE IF NOT EXISTS receivables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  description TEXT NOT NULL CHECK (char_length(BTRIM(description)) BETWEEN 1 AND 300),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  due_date DATE NOT NULL,
  -- How the customer is expected to pay; the real method is on each payment.
  method TEXT CHECK (method IS NULL OR method IN ('boleto', 'pix', 'cash', 'other')),
  -- Boleto number / document reference.
  reference TEXT CHECK (reference IS NULL OR char_length(reference) <= 200),
  installment_no INTEGER CHECK (installment_no IS NULL OR installment_no >= 1),
  installment_total INTEGER CHECK (installment_total IS NULL OR installment_total >= 1),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 2000),
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receivables_account_due ON receivables(account_id, due_date);
CREATE INDEX IF NOT EXISTS idx_receivables_deal ON receivables(deal_id) WHERE deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receivables_contact ON receivables(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receivables_quote ON receivables(quote_id) WHERE quote_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS receivable_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  receivable_id UUID NOT NULL REFERENCES receivables(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('boleto', 'pix', 'cash', 'other')),
  paid_at DATE NOT NULL DEFAULT ((NOW() AT TIME ZONE 'America/Fortaleza')::DATE),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  -- Cash only: the day the money was deposited; NULL = still on hand.
  deposited_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT receivable_payments_deposit_only_cash CHECK (deposited_at IS NULL OR method = 'cash')
);

CREATE INDEX IF NOT EXISTS idx_receivable_payments_receivable ON receivable_payments(receivable_id);
CREATE INDEX IF NOT EXISTS idx_receivable_payments_account_paid ON receivable_payments(account_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_receivable_payments_cash_on_hand
  ON receivable_payments(account_id) WHERE method = 'cash' AND deposited_at IS NULL;

DROP TRIGGER IF EXISTS set_updated_at ON receivables;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON receivables
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- Integrity: links stay inside the account, payments never exceed the amount
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receivables_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paid NUMERIC;
BEGIN
  IF NEW.contact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM contacts WHERE id = NEW.contact_id AND account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'contact is not in this account' USING ERRCODE = '23503';
  END IF;
  IF NEW.company_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM companies WHERE id = NEW.company_id AND account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'company is not in this account' USING ERRCODE = '23503';
  END IF;
  IF NEW.deal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM deals WHERE id = NEW.deal_id AND account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'deal is not in this account' USING ERRCODE = '23503';
  END IF;
  IF NEW.quote_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM quotes WHERE id = NEW.quote_id AND account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'quote is not in this account' USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM receivable_payments WHERE receivable_id = NEW.id;
    IF NEW.amount < v_paid THEN
      RAISE EXCEPTION 'amount is below what was already received' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.receivables_check() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.receivables_check() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS receivables_check ON receivables;
CREATE TRIGGER receivables_check
  BEFORE INSERT OR UPDATE ON receivables
  FOR EACH ROW EXECUTE FUNCTION public.receivables_check();

CREATE OR REPLACE FUNCTION public.receivable_payments_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount NUMERIC;
  v_account UUID;
  v_cancelled TIMESTAMPTZ;
  v_paid NUMERIC;
BEGIN
  -- Lock the receivable so two payments at once cannot both squeeze in.
  SELECT amount, account_id, cancelled_at INTO v_amount, v_account, v_cancelled
  FROM receivables WHERE id = NEW.receivable_id FOR UPDATE;

  IF NOT FOUND OR v_account <> NEW.account_id THEN
    RAISE EXCEPTION 'receivable is not in this account' USING ERRCODE = '23503';
  END IF;
  IF v_cancelled IS NOT NULL AND TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'receivable is cancelled' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM receivable_payments
  WHERE receivable_id = NEW.receivable_id AND id IS DISTINCT FROM NEW.id;

  IF v_paid + NEW.amount > v_amount THEN
    RAISE EXCEPTION 'payments exceed the receivable amount' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.receivable_payments_check() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.receivable_payments_check() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS receivable_payments_check ON receivable_payments;
CREATE TRIGGER receivable_payments_check
  BEFORE INSERT OR UPDATE ON receivable_payments
  FOR EACH ROW EXECUTE FUNCTION public.receivable_payments_check();

-- ------------------------------------------------------------
-- Row level security
-- ------------------------------------------------------------
ALTER TABLE receivables ENABLE ROW LEVEL SECURITY;
ALTER TABLE receivable_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS receivables_select ON receivables;
DROP POLICY IF EXISTS receivables_insert ON receivables;
DROP POLICY IF EXISTS receivables_update ON receivables;
DROP POLICY IF EXISTS receivables_delete ON receivables;
CREATE POLICY receivables_select ON receivables FOR SELECT
  USING (is_account_member(account_id, 'agent'));
CREATE POLICY receivables_insert ON receivables FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY receivables_update ON receivables FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY receivables_delete ON receivables FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS receivable_payments_select ON receivable_payments;
DROP POLICY IF EXISTS receivable_payments_insert ON receivable_payments;
DROP POLICY IF EXISTS receivable_payments_update ON receivable_payments;
DROP POLICY IF EXISTS receivable_payments_delete ON receivable_payments;
CREATE POLICY receivable_payments_select ON receivable_payments FOR SELECT
  USING (is_account_member(account_id, 'agent'));
CREATE POLICY receivable_payments_insert ON receivable_payments FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY receivable_payments_update ON receivable_payments FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY receivable_payments_delete ON receivable_payments FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- ------------------------------------------------------------
-- Balances and status. security_invoker: the caller's RLS applies.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW receivable_balances
WITH (security_invoker = on) AS
SELECT
  r.*,
  COALESCE(p.paid, 0)::NUMERIC(12, 2) AS paid_amount,
  (r.amount - COALESCE(p.paid, 0))::NUMERIC(12, 2) AS balance,
  p.last_paid_at,
  CASE
    WHEN r.cancelled_at IS NOT NULL THEN 'cancelled'
    WHEN COALESCE(p.paid, 0) >= r.amount THEN 'paid'
    WHEN r.due_date < ((NOW() AT TIME ZONE 'America/Fortaleza')::DATE) THEN 'overdue'
    WHEN COALESCE(p.paid, 0) > 0 THEN 'partial'
    ELSE 'open'
  END AS status
FROM receivables r
LEFT JOIN (
  SELECT receivable_id, SUM(amount) AS paid, MAX(paid_at) AS last_paid_at
  FROM receivable_payments
  GROUP BY receivable_id
) p ON p.receivable_id = r.id;

-- ------------------------------------------------------------
-- redeem_invitation(): same as 073 plus receivables and payments.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_other_members BOOLEAN;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id
  FOR UPDATE OF p, a;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE account_id = v_old_account_id
      AND user_id <> v_caller_id
  ) INTO v_has_other_members;

  IF v_has_other_members THEN
    RAISE EXCEPTION 'Your account has other members; remove them or transfer ownership before joining another account'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_logs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_pending_executions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flow_runs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deals WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM api_keys WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM webhook_endpoints WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quick_replies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM notifications WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_configs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_chunks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_usage_log WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM companies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM company_contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM email_accounts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deal_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deal_attachments WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deal_tasks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM products WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quotes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quote_items WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM product_suppliers WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM push_subscriptions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM email_message_bodies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM receivables WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM receivable_payments WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;
