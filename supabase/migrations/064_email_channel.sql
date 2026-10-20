-- ============================================================
-- 064_email_channel.sql — e-mail as a second inbox channel (phase 1)
--
-- The inbox keeps ONE conversation per (account, contact) (migration
-- 036), so e-mail lands in the same timeline as the contact's WhatsApp
-- messages. This adds:
--
--   * messages.channel ('whatsapp' | 'email') plus the e-mail fields
--     the bubble needs (subject, from, to). Inbound e-mail reuses the
--     existing (conversation_id, message_id) uniqueness for idempotency
--     by storing `message_id = 'email:<RFC Message-ID>'`.
--   * email_accounts — one mailbox per account (IMAP in, SMTP out). The
--     password is stored encrypted (ENCRYPTION_KEY, like the WhatsApp
--     token). RLS is on with NO policies: only the service role (our
--     server routes) can read or write it, so the secret never reaches
--     the browser.
--
-- IMPORTANT: the 059 trigger stamped conversations.last_inbound_at on
-- EVERY customer message. That column drives the WhatsApp 24-hour
-- window, and an incoming e-mail must not open it (Meta would reject
-- the free-form reply). The trigger now only counts WhatsApp messages.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS email_subject TEXT,
  ADD COLUMN IF NOT EXISTS email_from TEXT,
  ADD COLUMN IF NOT EXISTS email_to TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'messages_channel_check'
  ) THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_channel_check
      CHECK (channel IN ('whatsapp', 'email'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.track_conversation_message_times()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.sender_type = 'customer' THEN
      -- Only WhatsApp opens the 24h customer-service window.
      IF NEW.channel = 'whatsapp' THEN
        UPDATE conversations
        SET last_inbound_at = GREATEST(COALESCE(last_inbound_at, NEW.created_at), NEW.created_at)
        WHERE id = NEW.conversation_id;
      END IF;
    ELSIF (NEW.sender_type = 'agent' OR NEW.ai_generated) AND NEW.status IS DISTINCT FROM 'failed' THEN
      UPDATE conversations
      SET last_reply_at = GREATEST(COALESCE(last_reply_at, NEW.created_at), NEW.created_at)
      WHERE id = NEW.conversation_id;
    END IF;
  ELSIF NEW.status = 'failed'
    AND OLD.status IS DISTINCT FROM 'failed'
    AND (NEW.sender_type = 'agent' OR NEW.ai_generated) THEN
    UPDATE conversations
    SET last_reply_at = (
      SELECT max(m.created_at)
      FROM messages m
      WHERE m.conversation_id = NEW.conversation_id
        AND (m.sender_type = 'agent' OR m.ai_generated)
        AND m.status <> 'failed'
    )
    WHERE id = NEW.conversation_id;
  END IF;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.track_conversation_message_times() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.track_conversation_message_times() FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS email_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  username TEXT NOT NULL,
  password_encrypted TEXT NOT NULL,
  imap_host TEXT NOT NULL,
  imap_port INTEGER NOT NULL DEFAULT 993,
  imap_secure BOOLEAN NOT NULL DEFAULT TRUE,
  smtp_host TEXT NOT NULL,
  smtp_port INTEGER NOT NULL DEFAULT 465,
  smtp_secure BOOLEAN NOT NULL DEFAULT TRUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Highest INBOX UID already imported, and the UIDVALIDITY it belongs
  -- to (a change means the server renumbered the mailbox: start over).
  last_uid BIGINT,
  uid_validity BIGINT,
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  -- Claimed while a sync runs so overlapping triggers don't import twice.
  sync_started_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT email_accounts_ports_valid CHECK (
    imap_port BETWEEN 1 AND 65535 AND smtp_port BETWEEN 1 AND 65535
  )
);

DROP TRIGGER IF EXISTS set_updated_at ON email_accounts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON email_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Deliberately no policies: deny-all for anon/authenticated, the service
-- role bypasses RLS. The settings screen goes through /api/email/account.
ALTER TABLE email_accounts ENABLE ROW LEVEL SECURITY;
