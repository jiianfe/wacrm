-- ============================================================
-- 061_companies.sql — B2B companies (client accounts)
--
-- Adds a `companies` table (the customers a B2B team sells to) and
-- links contacts (people) and deals to it:
--
--   * contacts.company_id → companies   (a person works for a company)
--   * deals.company_id    → companies   (a deal is sold to a company)
--
-- This supersedes the loose `contacts.cnpj` text column added in 060:
-- the CNPJ now lives on the company and contacts reach it through
-- company_id. 060 only shipped test data, so the column is dropped.
--
-- CNPJ is stored without punctuation. Since July 2026 it can be
-- alphanumeric: 12 chars [0-9A-Z] followed by 2 numeric check digits.
-- It is unique per account when present.
--
-- RLS mirrors contacts (017): any member can read; agents and above
-- can write.
-- ============================================================

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  legal_name TEXT,
  trade_name TEXT,
  cnpj TEXT,
  state_registration TEXT,
  municipal_registration TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  address_zip TEXT,
  address_street TEXT,
  address_number TEXT,
  address_complement TEXT,
  address_district TEXT,
  address_city TEXT,
  address_state TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT companies_name_required CHECK (
    NULLIF(BTRIM(COALESCE(legal_name, '')), '') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(trade_name, '')), '') IS NOT NULL
  ),
  CONSTRAINT companies_cnpj_format CHECK (
    cnpj IS NULL OR cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$'
  ),
  CONSTRAINT companies_address_zip_format CHECK (
    address_zip IS NULL OR address_zip ~ '^[0-9]{8}$'
  ),
  CONSTRAINT companies_address_state_format CHECK (
    address_state IS NULL OR address_state ~ '^[A-Z]{2}$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_account_cnpj
  ON companies(account_id, cnpj)
  WHERE cnpj IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_companies_account_created
  ON companies(account_id, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON companies;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS companies_select ON companies;
DROP POLICY IF EXISTS companies_insert ON companies;
DROP POLICY IF EXISTS companies_update ON companies;
DROP POLICY IF EXISTS companies_delete ON companies;
CREATE POLICY companies_select ON companies FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY companies_insert ON companies FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY companies_update ON companies FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
CREATE POLICY companies_delete ON companies FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- Contacts: replace the loose CNPJ with a link to the company.
-- Dropping the column also drops its index and CHECK constraint (060).
ALTER TABLE contacts DROP COLUMN IF EXISTS cnpj;
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_company_id
  ON contacts(company_id)
  WHERE company_id IS NOT NULL;

-- Deals: optional link to the company the deal is sold to.
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_deals_company_id
  ON deals(company_id)
  WHERE company_id IS NOT NULL;
