-- ============================================================
-- 068_deal_notes_and_documents.sql — dated notes and documents on deals
--
-- Until now a deal had ONE free-text `notes` column: no history, no dates.
-- This adds, per deal:
--
--   deal_notes        — a timeline of notes, each stamped with the moment
--                       it was written and who wrote it. Notes are
--                       append-only (no UPDATE policy) so the date stays
--                       true; the author or an admin can delete one.
--   deal_attachments  — documents (quotes, invoices, boletos...) stored in
--                       a PRIVATE storage bucket; the table keeps the
--                       metadata and a category.
--
-- The old `deals.notes` text is copied into the timeline once (dated with
-- the deal's last update) and left in place, so nothing is lost.
--
-- Files live in the private `deal-documents` bucket under
--   account-<account_id>/<deal_id>/<uuid>-<name>
-- and are read through short-lived signed URLs. Size is capped at 10 MB
-- and only document-like types are accepted.
--
-- redeem_invitation() is redefined at the end so the two new account-scoped
-- tables are part of the "does the old account hold data?" check.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_id_account
  ON deals(id, account_id);

-- ------------------------------------------------------------
-- deal_notes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Snapshot of the author's name so the history survives renames and
  -- removed users.
  author_name TEXT,
  body TEXT NOT NULL CHECK (char_length(BTRIM(body)) BETWEEN 1 AND 10000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT deal_notes_deal_fk
    FOREIGN KEY (deal_id, account_id)
    REFERENCES deals(id, account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deal_notes_deal
  ON deal_notes(deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_notes_account
  ON deal_notes(account_id);

ALTER TABLE deal_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_notes_select ON deal_notes;
DROP POLICY IF EXISTS deal_notes_insert ON deal_notes;
DROP POLICY IF EXISTS deal_notes_delete ON deal_notes;
CREATE POLICY deal_notes_select ON deal_notes FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY deal_notes_insert ON deal_notes FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND user_id = auth.uid());
CREATE POLICY deal_notes_delete ON deal_notes FOR DELETE
  USING (
    is_account_member(account_id, 'agent')
    AND (user_id = auth.uid() OR is_account_member(account_id, 'admin'))
  );

-- One-off copy of the legacy single note into the timeline.
INSERT INTO deal_notes (deal_id, account_id, user_id, author_name, body, created_at)
SELECT d.id,
       d.account_id,
       d.user_id,
       p.full_name,
       LEFT(BTRIM(d.notes), 10000),
       COALESCE(d.updated_at, d.created_at)
FROM deals d
LEFT JOIN profiles p ON p.user_id = d.user_id
WHERE d.notes IS NOT NULL
  AND BTRIM(d.notes) <> ''
  AND NOT EXISTS (SELECT 1 FROM deal_notes n WHERE n.deal_id = d.id);

-- ------------------------------------------------------------
-- deal_attachments
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name TEXT,
  file_name TEXT NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  storage_path TEXT NOT NULL UNIQUE,
  mime_type TEXT,
  size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('quote', 'invoice', 'boleto', 'other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT deal_attachments_deal_fk
    FOREIGN KEY (deal_id, account_id)
    REFERENCES deals(id, account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deal_attachments_deal
  ON deal_attachments(deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_attachments_account
  ON deal_attachments(account_id);

ALTER TABLE deal_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_attachments_select ON deal_attachments;
DROP POLICY IF EXISTS deal_attachments_insert ON deal_attachments;
DROP POLICY IF EXISTS deal_attachments_delete ON deal_attachments;
CREATE POLICY deal_attachments_select ON deal_attachments FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY deal_attachments_insert ON deal_attachments FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND user_id = auth.uid());
CREATE POLICY deal_attachments_delete ON deal_attachments FOR DELETE
  USING (
    is_account_member(account_id, 'agent')
    AND (user_id = auth.uid() OR is_account_member(account_id, 'admin'))
  );

-- ------------------------------------------------------------
-- Private storage bucket
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'deal-documents',
  'deal-documents',
  FALSE,
  10485760, -- 10 MB
  ARRAY[
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp',
    -- NF-e XML
    'application/xml', 'text/xml',
    'application/zip', 'application/x-zip-compressed',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Access follows the first path segment, `account-<uuid>`. The CASE keeps
-- the uuid cast from running on a malformed folder name.
DROP POLICY IF EXISTS "Members can read deal documents" ON storage.objects;
CREATE POLICY "Members can read deal documents"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'deal-documents'
    AND CASE
      WHEN (storage.foldername(name))[1] ~ '^account-[0-9a-f-]{36}$'
        THEN public.is_account_member(
          (SUBSTRING((storage.foldername(name))[1] FROM 9))::uuid
        )
      ELSE FALSE
    END
  );

DROP POLICY IF EXISTS "Agents can upload deal documents" ON storage.objects;
CREATE POLICY "Agents can upload deal documents"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'deal-documents'
    AND CASE
      WHEN (storage.foldername(name))[1] ~ '^account-[0-9a-f-]{36}$'
        THEN public.is_account_member(
          (SUBSTRING((storage.foldername(name))[1] FROM 9))::uuid,
          'agent'
        )
      ELSE FALSE
    END
  );

DROP POLICY IF EXISTS "Agents can delete deal documents" ON storage.objects;
CREATE POLICY "Agents can delete deal documents"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'deal-documents'
    AND CASE
      WHEN (storage.foldername(name))[1] ~ '^account-[0-9a-f-]{36}$'
        THEN public.is_account_member(
          (SUBSTRING((storage.foldername(name))[1] FROM 9))::uuid,
          'agent'
        )
      ELSE FALSE
    END
  );

-- ------------------------------------------------------------
-- redeem_invitation(): same as 067 plus deal_notes and deal_attachments.
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
