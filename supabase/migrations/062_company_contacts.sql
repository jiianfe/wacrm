-- ============================================================
-- 062_company_contacts.sql — many-to-many companies <-> contacts
--
-- A person can be the contact of several companies (a consultant, an
-- accountant, a buyer who covers more than one site), and a company has
-- several contacts. 061 modelled this with a single `contacts.company_id`;
-- this replaces it with a link table that also carries the person's job
-- title at that company.
--
--   company_contacts(company_id, contact_id, account_id, job_title)
--
-- Same-account integrity is enforced with composite foreign keys: a link
-- can only join a company and a contact that belong to `account_id`.
--
-- 061 shipped moments ago, so existing `contacts.company_id` values are
-- backfilled into the link table before the column is dropped.
-- RLS mirrors contacts (017): members read, agents and above write.
-- ============================================================

-- Composite FK targets (id is already unique; this adds the pair).
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_id_account
  ON companies(id, account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_id_account
  ON contacts(id, account_id);

CREATE TABLE IF NOT EXISTS company_contacts (
  company_id UUID NOT NULL,
  contact_id UUID NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  job_title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, contact_id),
  CONSTRAINT company_contacts_company_fk
    FOREIGN KEY (company_id, account_id)
    REFERENCES companies(id, account_id) ON DELETE CASCADE,
  CONSTRAINT company_contacts_contact_fk
    FOREIGN KEY (contact_id, account_id)
    REFERENCES contacts(id, account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_company_contacts_contact
  ON company_contacts(contact_id);
CREATE INDEX IF NOT EXISTS idx_company_contacts_account
  ON company_contacts(account_id);

ALTER TABLE company_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_contacts_select ON company_contacts;
DROP POLICY IF EXISTS company_contacts_insert ON company_contacts;
DROP POLICY IF EXISTS company_contacts_update ON company_contacts;
DROP POLICY IF EXISTS company_contacts_delete ON company_contacts;
CREATE POLICY company_contacts_select ON company_contacts FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY company_contacts_insert ON company_contacts FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY company_contacts_update ON company_contacts FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
CREATE POLICY company_contacts_delete ON company_contacts FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- Backfill from the 061 single-company link, then retire the column.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contacts'
      AND column_name = 'company_id'
  ) THEN
    INSERT INTO company_contacts (company_id, contact_id, account_id)
    SELECT c.company_id, c.id, c.account_id
    FROM contacts c
    JOIN companies co ON co.id = c.company_id AND co.account_id = c.account_id
    WHERE c.company_id IS NOT NULL
    ON CONFLICT DO NOTHING;

    ALTER TABLE contacts DROP COLUMN company_id;
  END IF;
END $$;
