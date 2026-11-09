-- ============================================================
-- 078_task_notes_attachments.sql — dated notes and files on tasks
--
--   task_notes        a timeline per task; each note keeps the moment it was
--                     written and who wrote it. Append-only (no UPDATE
--                     policy) so the dates stay true; the author or an admin
--                     can delete one.
--   task_attachments  documents and photos on a task. The files live in the
--                     existing private `deal-documents` bucket (10 MB cap,
--                     PDF/images/office types) under
--                       account-<account_id>/tasks/<task_id>/<uuid>-<name>
--                     — the bucket policies only look at the first folder, so
--                     no storage change is needed.
--
-- Deleting a task removes its notes and attachment rows (the app removes the
-- files when a person deletes an attachment).
-- redeem_invitation() is redefined so both tables count as account data.
-- ============================================================

CREATE TABLE IF NOT EXISTS task_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Snapshot of the author's name so the history survives renames.
  author_name TEXT,
  body TEXT NOT NULL CHECK (char_length(BTRIM(body)) BETWEEN 1 AND 10000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT task_notes_task_fk
    FOREIGN KEY (task_id, account_id)
    REFERENCES deal_tasks(id, account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_notes_task ON task_notes(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_notes_account ON task_notes(account_id);

ALTER TABLE task_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_notes_select ON task_notes;
DROP POLICY IF EXISTS task_notes_insert ON task_notes;
DROP POLICY IF EXISTS task_notes_delete ON task_notes;
CREATE POLICY task_notes_select ON task_notes FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY task_notes_insert ON task_notes FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND user_id = auth.uid());
CREATE POLICY task_notes_delete ON task_notes FOR DELETE
  USING (
    is_account_member(account_id, 'agent')
    AND (user_id = auth.uid() OR is_account_member(account_id, 'admin'))
  );

CREATE TABLE IF NOT EXISTS task_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name TEXT,
  file_name TEXT NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  storage_path TEXT NOT NULL UNIQUE,
  mime_type TEXT,
  size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT task_attachments_task_fk
    FOREIGN KEY (task_id, account_id)
    REFERENCES deal_tasks(id, account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_attachments_account ON task_attachments(account_id);

ALTER TABLE task_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_attachments_select ON task_attachments;
DROP POLICY IF EXISTS task_attachments_insert ON task_attachments;
DROP POLICY IF EXISTS task_attachments_delete ON task_attachments;
CREATE POLICY task_attachments_select ON task_attachments FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY task_attachments_insert ON task_attachments FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND user_id = auth.uid());
CREATE POLICY task_attachments_delete ON task_attachments FOR DELETE
  USING (
    is_account_member(account_id, 'agent')
    AND (user_id = auth.uid() OR is_account_member(account_id, 'admin'))
  );

-- ------------------------------------------------------------
-- redeem_invitation(): same as 077 plus task_notes and task_attachments.
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
    UNION ALL SELECT 1 FROM task_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM task_attachments WHERE account_id = v_old_account_id
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
