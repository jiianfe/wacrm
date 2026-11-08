-- ============================================================
-- 076_tasks_standalone.sql — task management on top of deal_tasks
--
-- deal_tasks (069) becomes the account's task table:
--   deal_id       now optional: a task can stand alone ("ligar para o
--                 fornecedor") or hang on a deal as before
--   contact_id /  optional link to a customer, shown on the task and on
--   company_id    the Tasks page (set NULL when the customer is deleted)
--   priority      low | normal | high
--   reminded_on   last day a reminder was sent for this task, so the
--                 scheduled job notifies at most once a day
--
-- notifications gain the type 'task_due' and a task_id, so a reminder
-- shows up in the bell/notifications page like any other alert.
--
-- Access is unchanged: members read; agents and above write.
-- ============================================================

ALTER TABLE deal_tasks ALTER COLUMN deal_id DROP NOT NULL;

ALTER TABLE deal_tasks
  ADD COLUMN IF NOT EXISTS contact_id UUID,
  ADD COLUMN IF NOT EXISTS company_id UUID,
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS reminded_on DATE;

ALTER TABLE deal_tasks DROP CONSTRAINT IF EXISTS deal_tasks_priority_check;
ALTER TABLE deal_tasks
  ADD CONSTRAINT deal_tasks_priority_check
  CHECK (priority IN ('low', 'normal', 'high'));

-- Same-account guarantee, like deal_tasks_deal_fk. SET NULL clears only the
-- customer column (account_id is NOT NULL and must stay).
ALTER TABLE deal_tasks DROP CONSTRAINT IF EXISTS deal_tasks_contact_fk;
ALTER TABLE deal_tasks
  ADD CONSTRAINT deal_tasks_contact_fk
  FOREIGN KEY (contact_id, account_id)
  REFERENCES contacts(id, account_id) ON DELETE SET NULL (contact_id);

ALTER TABLE deal_tasks DROP CONSTRAINT IF EXISTS deal_tasks_company_fk;
ALTER TABLE deal_tasks
  ADD CONSTRAINT deal_tasks_company_fk
  FOREIGN KEY (company_id, account_id)
  REFERENCES companies(id, account_id) ON DELETE SET NULL (company_id);

CREATE INDEX IF NOT EXISTS idx_deal_tasks_assignee_open
  ON deal_tasks(assigned_to, end_date)
  WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deal_tasks_contact
  ON deal_tasks(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deal_tasks_company
  ON deal_tasks(company_id) WHERE company_id IS NOT NULL;

-- ------------------------------------------------------------
-- Notifications for task reminders.
-- ------------------------------------------------------------
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'task_due'));

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES deal_tasks(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_notifications_task
  ON notifications(task_id) WHERE task_id IS NOT NULL;
