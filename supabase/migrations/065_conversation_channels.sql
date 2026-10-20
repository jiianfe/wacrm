-- ============================================================
-- 065_conversation_channels.sql — which channels a conversation has
--
-- A contact has ONE conversation (migration 036) that can hold WhatsApp
-- and e-mail messages (064). The inbox needs to filter the list by
-- channel ("only WhatsApp", "only e-mail") without scanning messages, so
-- each conversation carries two flags kept up to date by a trigger:
--
--   has_whatsapp — it has (or, before any message exists, may get)
--                  WhatsApp messages
--   has_email    — it has at least one e-mail message
--
-- The trigger only does work the first time a channel appears in a
-- conversation (the UPDATE is gated on the flag still being false), so
-- the per-message cost is one indexed lookup.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS has_whatsapp BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS has_email BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill without bumping updated_at (the inbox sorts and badges on it).
ALTER TABLE conversations DISABLE TRIGGER set_updated_at;

UPDATE conversations c
SET has_email = TRUE
WHERE EXISTS (
  SELECT 1 FROM messages m
  WHERE m.conversation_id = c.id AND m.channel = 'email'
);

-- Conversations with no messages yet stay in the WhatsApp view: that is
-- where a freshly started conversation belongs.
UPDATE conversations c
SET has_whatsapp = TRUE
WHERE EXISTS (
  SELECT 1 FROM messages m
  WHERE m.conversation_id = c.id AND m.channel = 'whatsapp'
)
OR NOT EXISTS (
  SELECT 1 FROM messages m WHERE m.conversation_id = c.id
);

ALTER TABLE conversations ENABLE TRIGGER set_updated_at;

CREATE OR REPLACE FUNCTION public.track_conversation_channels()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.channel = 'email' THEN
    UPDATE conversations SET has_email = TRUE
    WHERE id = NEW.conversation_id AND NOT has_email;
  ELSE
    UPDATE conversations SET has_whatsapp = TRUE
    WHERE id = NEW.conversation_id AND NOT has_whatsapp;
  END IF;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.track_conversation_channels() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.track_conversation_channels() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS messages_track_channels ON messages;
CREATE TRIGGER messages_track_channels
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION public.track_conversation_channels();
