-- ============================================================
-- 077_task_dependencies.sql — "task B waits for task A"
--
-- task_dependencies(task_id, depends_on_id): task_id cannot be finished
-- until depends_on_id is done (the app enforces the "finish" rule; the
-- database guarantees the graph is sane):
--   * both tasks belong to the same account (composite FKs)
--   * a task never depends on itself
--   * no cycles (A->B->C->A) — checked by trigger on insert
-- Deleting a task removes its edges. Access: members read; agents write.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_tasks_id_account
  ON deal_tasks(id, account_id);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id UUID NOT NULL,
  depends_on_id UUID NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, depends_on_id),
  CONSTRAINT task_dependencies_not_self CHECK (task_id <> depends_on_id),
  CONSTRAINT task_dependencies_task_fk
    FOREIGN KEY (task_id, account_id)
    REFERENCES deal_tasks(id, account_id) ON DELETE CASCADE,
  CONSTRAINT task_dependencies_dep_fk
    FOREIGN KEY (depends_on_id, account_id)
    REFERENCES deal_tasks(id, account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_dependencies_dep
  ON task_dependencies(depends_on_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_account
  ON task_dependencies(account_id);

CREATE OR REPLACE FUNCTION public.task_dependencies_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Walk up from the new prerequisite; reaching the task itself = a cycle.
  IF EXISTS (
    WITH RECURSIVE up(id) AS (
      SELECT NEW.depends_on_id
      UNION
      SELECT d.depends_on_id
      FROM task_dependencies d
      JOIN up ON d.task_id = up.id
    )
    SELECT 1 FROM up WHERE id = NEW.task_id
  ) THEN
    RAISE EXCEPTION 'Task dependency would create a cycle' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS task_dependencies_check ON task_dependencies;
CREATE TRIGGER task_dependencies_check
  BEFORE INSERT ON task_dependencies
  FOR EACH ROW EXECUTE FUNCTION public.task_dependencies_check();

ALTER TABLE task_dependencies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_dependencies_select ON task_dependencies;
DROP POLICY IF EXISTS task_dependencies_insert ON task_dependencies;
DROP POLICY IF EXISTS task_dependencies_delete ON task_dependencies;
CREATE POLICY task_dependencies_select ON task_dependencies FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY task_dependencies_insert ON task_dependencies FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY task_dependencies_delete ON task_dependencies FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- ------------------------------------------------------------
-- redeem_invitation(): same as 075 plus task_dependencies.
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
    UNION ALL SELECT 1 FROM task_dependencies WHERE account_id = v_old_account_id
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
