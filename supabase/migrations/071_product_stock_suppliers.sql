-- ============================================================
-- 071_product_stock_suppliers.sql — stock, tax data and suppliers on products
--
--   products          + purchase_price, stock_qty (saldo), min_stock, cest,
--                       ean (EAN-13), ean_tributado, origin (ICMS origin 0-8)
--   product_suppliers suppliers of a product (razão social, nome fantasia,
--                     last price, date, number, origin), typed by hand
--   quote_items       + product_id and deduct_stock: a line that must come
--                     off the stock
--
-- Stock moves when a quote becomes "approved" (trigger below): every line
-- with deduct_stock subtracts its quantity from the product's stock_qty.
-- Moving the quote out of "approved" puts the quantities back.
--
-- redeem_invitation() is redefined so product_suppliers counts as data.
-- ============================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS purchase_price NUMERIC(12, 2) CHECK (purchase_price IS NULL OR purchase_price >= 0),
  ADD COLUMN IF NOT EXISTS stock_qty NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_stock NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  ADD COLUMN IF NOT EXISTS cest TEXT CHECK (cest IS NULL OR char_length(cest) <= 12),
  ADD COLUMN IF NOT EXISTS ean TEXT CHECK (ean IS NULL OR char_length(ean) <= 14),
  ADD COLUMN IF NOT EXISTS ean_tributado TEXT CHECK (ean_tributado IS NULL OR char_length(ean_tributado) <= 14),
  ADD COLUMN IF NOT EXISTS origin SMALLINT CHECK (origin IS NULL OR origin BETWEEN 0 AND 8);

CREATE TABLE IF NOT EXISTS product_suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  legal_name TEXT NOT NULL CHECK (char_length(BTRIM(legal_name)) BETWEEN 1 AND 200),
  trade_name TEXT CHECK (trade_name IS NULL OR char_length(trade_name) <= 200),
  last_price NUMERIC(12, 2) CHECK (last_price IS NULL OR last_price >= 0),
  last_date DATE,
  doc_number TEXT CHECK (doc_number IS NULL OR char_length(doc_number) <= 40),
  origin TEXT CHECK (origin IS NULL OR char_length(origin) <= 80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_suppliers_product ON product_suppliers(product_id);
CREATE INDEX IF NOT EXISTS idx_product_suppliers_account ON product_suppliers(account_id);

ALTER TABLE product_suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_suppliers_select ON product_suppliers;
DROP POLICY IF EXISTS product_suppliers_insert ON product_suppliers;
DROP POLICY IF EXISTS product_suppliers_update ON product_suppliers;
DROP POLICY IF EXISTS product_suppliers_delete ON product_suppliers;
CREATE POLICY product_suppliers_select ON product_suppliers FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY product_suppliers_insert ON product_suppliers FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY product_suppliers_update ON product_suppliers FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY product_suppliers_delete ON product_suppliers FOR DELETE
  USING (is_account_member(account_id, 'agent'));

ALTER TABLE quote_items
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deduct_stock BOOLEAN NOT NULL DEFAULT FALSE;

-- ------------------------------------------------------------
-- Stock movement when a quote enters / leaves "approved".
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_quote_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_sign INTEGER := 0;
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    v_sign := -1;
  ELSIF OLD.status = 'approved' AND NEW.status <> 'approved' THEN
    v_sign := 1;
  END IF;
  IF v_sign = 0 THEN
    RETURN NEW;
  END IF;

  UPDATE products p
  SET stock_qty = p.stock_qty + v_sign * s.qty
  FROM (
    SELECT product_id, SUM(quantity) AS qty
    FROM quote_items
    WHERE quote_id = NEW.id AND deduct_stock AND product_id IS NOT NULL
    GROUP BY product_id
  ) s
  WHERE p.id = s.product_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotes_apply_stock ON quotes;
CREATE TRIGGER quotes_apply_stock AFTER UPDATE OF status ON quotes
  FOR EACH ROW EXECUTE FUNCTION public.apply_quote_stock();

-- ------------------------------------------------------------
-- redeem_invitation(): same as 070 plus product_suppliers.
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
