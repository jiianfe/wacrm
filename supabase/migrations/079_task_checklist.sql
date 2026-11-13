-- ============================================================
-- 079_task_checklist.sql — checklist items (e.g. materials to buy) on tasks
--
-- Each task can hold a list of items with a checkbox. Ticking one records
-- when it was done. Deleting a task removes its items.
-- ============================================================

CREATE TABLE IF NOT EXISTS task_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  label TEXT NOT NULL CHECK (char_length(BTRIM(label)) BETWEEN 1 AND 300),
  done BOOLEAN NOT NULL DEFAULT FALSE,
  done_at TIMESTAMPTZ,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT task_checklist_task_fk
    FOREIGN KEY (task_id, account_id)
    REFERENCES deal_tasks(id, account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_checklist_task ON task_checklist_items(task_id, position, created_at);
CREATE INDEX IF NOT EXISTS idx_task_checklist_account ON task_checklist_items(account_id);

ALTER TABLE task_checklist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_checklist_select ON task_checklist_items;
DROP POLICY IF EXISTS task_checklist_insert ON task_checklist_items;
DROP POLICY IF EXISTS task_checklist_update ON task_checklist_items;
DROP POLICY IF EXISTS task_checklist_delete ON task_checklist_items;
CREATE POLICY task_checklist_select ON task_checklist_items FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY task_checklist_insert ON task_checklist_items FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY task_checklist_update ON task_checklist_items FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY task_checklist_delete ON task_checklist_items FOR DELETE
  USING (is_account_member(account_id, 'agent'));
