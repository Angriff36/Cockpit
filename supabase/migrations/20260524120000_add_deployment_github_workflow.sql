ALTER TABLE deployment_targets
  ADD COLUMN IF NOT EXISTS github_workflow_file text NOT NULL DEFAULT '';
