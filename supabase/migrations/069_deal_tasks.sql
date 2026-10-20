-- ============================================================
-- 069_deal_tasks.sql — tasks on deals (pipeline cards)
--
-- A deal can carry tasks, each with a start and an end date. The card on
-- the board turns green while an open task is within its period and red
-- once an open task's end date has passed (the colour logic lives in the
-- app: src/lib/deal-tasks.ts).
--
--   start_date / end_date  plain dates (no time of day); a task is "live"
--                          from start_date through the whole end_date
--   completed_at           set when the task is marked done; NULL = open
--   assigned_to            who is responsible (a profile), optional
--
-- Access mirrors the other deal tables: members read; agents and above
-- create, edit and delete.
--
-- redeem_invitation() is redefined at the end so deal_tasks counts as
-- account data in the "does the old account hold data?" check.
-- ============================================================

CREATE TABLE IF NOT EXISTS deal_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (char_length(BTRIM(title)) BETWEEN 1 AND 200),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 2000),
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE NOT NULL DEFAULT CURRENT_DATE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT deal_tasks_dates_ordered CHECK (end_date >= start_date),
  CONSTRAINT deal_tasks_deal_fk
    FOREIGN KEY (deal_id, account_id)
    REFERENCES deals(id, account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deal_tasks_deal
  ON deal_tasks(deal_id, end_date);
CREATE INDEX IF NOT EXISTS idx_deal_tasks_account
  ON deal_tasks(account_id);
-- Open tasks are what the board and any "overdue" view look at.
CREATE INDEX IF NOT EXISTS idx_deal_tasks_open
  ON deal_tasks(account_id, end_date)
  WHERE completed_at IS NULL;

DROP TRIGGER IF EXISTS set_updated_at ON deal_tasks;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON deal_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE deal_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_tasks_select ON deal_tasks;
DROP POLICY IF EXISTS deal_tasks_insert ON deal_tasks;
DROP POLICY IF EXISTS deal_tasks_update ON deal_tasks;
DROP POLICY IF EXISTS deal_tasks_delete ON deal_tasks;
CREATE POLICY deal_tasks_select ON deal_tasks FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY deal_tasks_insert ON deal_tasks FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY deal_tasks_update ON deal_tasks FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY deal_tasks_delete ON deal_tasks FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- ------------------------------------------------------------
-- redeem_invitation(): same as 068 plus deal_tasks.
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
