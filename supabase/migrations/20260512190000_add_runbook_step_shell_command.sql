-- Add shell command support to runbook steps for daemon auto-run integration

ALTER TABLE runbook_steps
  ADD COLUMN IF NOT EXISTS shell_command text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS auto_run boolean NOT NULL DEFAULT false;
