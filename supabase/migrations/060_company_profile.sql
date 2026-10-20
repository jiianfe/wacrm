-- ============================================================
-- 060_company_profile.sql — Company registration + contact CNPJ
--
-- 1. `accounts` gains the company's own registration data (legal name,
--    CNPJ, state/municipal registration, phone, e-mail, address) so it
--    lives in one place — e.g. for the quotes (orçamentos) feature.
-- 2. `contacts` gains an optional `cnpj`, linking a contact to the
--    company it works for. Several contacts may share a CNPJ, so there
--    is deliberately no unique index (only a lookup index).
--
-- CNPJ is stored without punctuation. Since July 2026 a CNPJ may be
-- alphanumeric: 12 chars [0-9A-Z] followed by 2 numeric check digits.
--
-- RLS: no change needed. `accounts_update` (017) already restricts
-- writes to admins+, and the contacts policies already cover new
-- columns on existing rows.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS legal_name TEXT,
  ADD COLUMN IF NOT EXISTS trade_name TEXT,
  ADD COLUMN IF NOT EXISTS cnpj TEXT,
  ADD COLUMN IF NOT EXISTS state_registration TEXT,
  ADD COLUMN IF NOT EXISTS municipal_registration TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS address_zip TEXT,
  ADD COLUMN IF NOT EXISTS address_street TEXT,
  ADD COLUMN IF NOT EXISTS address_number TEXT,
  ADD COLUMN IF NOT EXISTS address_complement TEXT,
  ADD COLUMN IF NOT EXISTS address_district TEXT,
  ADD COLUMN IF NOT EXISTS address_city TEXT,
  ADD COLUMN IF NOT EXISTS address_state TEXT;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS cnpj TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_cnpj_format'
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_cnpj_format
      CHECK (cnpj IS NULL OR cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_address_zip_format'
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_address_zip_format
      CHECK (address_zip IS NULL OR address_zip ~ '^[0-9]{8}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_address_state_format'
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_address_state_format
      CHECK (address_state IS NULL OR address_state ~ '^[A-Z]{2}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_cnpj_format'
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_cnpj_format
      CHECK (cnpj IS NULL OR cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contacts_account_cnpj
  ON contacts(account_id, cnpj)
  WHERE cnpj IS NOT NULL;
