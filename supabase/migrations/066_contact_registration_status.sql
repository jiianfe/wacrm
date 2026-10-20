-- ============================================================
-- 066_contact_registration_status.sql — don't register strangers
--
-- Anyone who writes to the account (WhatsApp or e-mail) used to become a
-- contact right away. A conversation still needs a contact row, so the
-- row is kept, but it is now marked `pending` until someone decides to
-- register it:
--
--   registered — a real contact (default; every existing contact)
--   pending    — created automatically by an inbound message, not yet
--                accepted. Hidden from the contact list and from the
--                pickers (deals, companies, broadcasts); shown in the
--                inbox with a "register / ignore" prompt. Automations,
--                flows and the AI auto-reply stay quiet for it.
--
-- Registering flips it to `registered`. Existing rows are untouched.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS registration_status TEXT NOT NULL DEFAULT 'registered';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_registration_status_check'
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_registration_status_check
      CHECK (registration_status IN ('registered', 'pending'));
  END IF;
END $$;

-- Only the (few) pending rows are ever looked up by status.
CREATE INDEX IF NOT EXISTS idx_contacts_account_pending
  ON contacts(account_id)
  WHERE registration_status = 'pending';
