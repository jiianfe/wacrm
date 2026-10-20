-- ============================================================
-- 063_company_tags_and_fields.sql — tags and custom fields on companies
--
-- For B2B the company is the thing you classify ("Construtora",
-- "Origem do lead"), so tags and custom fields can now be set on
-- companies. The tag / field *definitions* (tags, custom_fields) are
-- shared and keep being managed in Settings → Fields & tags; only the
-- assignments are new:
--
--   company_tags(company_id, tag_id)
--   company_custom_values(company_id, custom_field_id, value)
--
-- Both mirror their contact counterparts (001/017): one row per
-- assignment, unique per pair, access follows the company's account
-- (members read, agents and above write).
-- ============================================================

CREATE TABLE IF NOT EXISTS company_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_company_tags_company ON company_tags(company_id);
CREATE INDEX IF NOT EXISTS idx_company_tags_tag ON company_tags(tag_id);

ALTER TABLE company_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_tags_select ON company_tags;
DROP POLICY IF EXISTS company_tags_modify ON company_tags;
CREATE POLICY company_tags_select ON company_tags FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM companies c
    WHERE c.id = company_tags.company_id AND is_account_member(c.account_id)
  )
);
CREATE POLICY company_tags_modify ON company_tags FOR ALL USING (
  EXISTS (
    SELECT 1 FROM companies c
    WHERE c.id = company_tags.company_id AND is_account_member(c.account_id, 'agent')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM companies c
    WHERE c.id = company_tags.company_id AND is_account_member(c.account_id, 'agent')
  )
);

CREATE TABLE IF NOT EXISTS company_custom_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  custom_field_id UUID NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, custom_field_id)
);

CREATE INDEX IF NOT EXISTS idx_company_custom_values_company
  ON company_custom_values(company_id);

ALTER TABLE company_custom_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_custom_values_select ON company_custom_values;
DROP POLICY IF EXISTS company_custom_values_modify ON company_custom_values;
CREATE POLICY company_custom_values_select ON company_custom_values FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM companies c
    WHERE c.id = company_custom_values.company_id AND is_account_member(c.account_id)
  )
);
CREATE POLICY company_custom_values_modify ON company_custom_values FOR ALL USING (
  EXISTS (
    SELECT 1 FROM companies c
    WHERE c.id = company_custom_values.company_id AND is_account_member(c.account_id, 'agent')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM companies c
    WHERE c.id = company_custom_values.company_id AND is_account_member(c.account_id, 'agent')
  )
);
