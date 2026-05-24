/*
  # Command Run History

  Tracks execution history for each command profile:
  - timestamp of each run
  - exit code (null if still running or killed without code)
  - duration in milliseconds
  - triggered_by: 'manual' | 'launch_group' | 'daemon'

  Capped queries — UI shows last N runs per command.
*/

CREATE TABLE IF NOT EXISTS command_run_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id uuid NOT NULL REFERENCES command_profiles(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  exit_code integer,
  duration_ms integer,
  triggered_by text NOT NULL DEFAULT 'manual',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Index for fast lookups: recent runs per command
CREATE INDEX idx_command_run_history_command_id ON command_run_history(command_id, started_at DESC);
-- Index for project-wide queries
CREATE INDEX idx_command_run_history_project_id ON command_run_history(project_id, started_at DESC);

ALTER TABLE command_run_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select command_run_history" ON command_run_history FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners insert command_run_history" ON command_run_history FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update command_run_history" ON command_run_history FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners delete command_run_history" ON command_run_history FOR DELETE TO authenticated USING (auth.uid() = owner_id);
