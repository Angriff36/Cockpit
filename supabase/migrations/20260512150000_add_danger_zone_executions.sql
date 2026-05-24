/*
  # Danger Zone Execution Audit Log

  Tracks every execution of a danger zone command with full audit context:
  - Who ran it (owner_id, resolved at query time via auth)
  - What command was run (label, command text, risk level)
  - When it was executed
  - The outcome (executed, aborted, failed)
  - Optional notes from the operator

  Denormalized command details so history survives command edits/deletes.
*/

CREATE TABLE IF NOT EXISTS danger_zone_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  danger_zone_command_id uuid REFERENCES danger_zone_commands(id) ON DELETE SET NULL,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  command_label text NOT NULL DEFAULT '',
  command_text text NOT NULL DEFAULT '',
  risk_level text NOT NULL DEFAULT 'high',
  environment text NOT NULL DEFAULT '',
  outcome text NOT NULL DEFAULT 'executed',
  notes text NOT NULL DEFAULT '',
  executed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE danger_zone_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select danger_zone_executions" ON danger_zone_executions FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners insert danger_zone_executions" ON danger_zone_executions FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners delete danger_zone_executions" ON danger_zone_executions FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_dz_executions_project ON danger_zone_executions(project_id);
CREATE INDEX IF NOT EXISTS idx_dz_executions_created ON danger_zone_executions(executed_at DESC);
