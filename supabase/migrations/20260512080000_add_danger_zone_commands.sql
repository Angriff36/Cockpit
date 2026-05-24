/*
  # Danger Zone Command Registry

  Dedicated table for registering commands that require extra confirmation
  before execution (e.g., `db:reset`, `docker system prune`).

  These entries are always included in agent context exports.
*/

CREATE TABLE IF NOT EXISTS danger_zone_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  command text NOT NULL DEFAULT '',
  label text NOT NULL DEFAULT '',
  risk_level text NOT NULL DEFAULT 'high',
  description text NOT NULL DEFAULT '',
  requires_confirmation boolean NOT NULL DEFAULT true,
  environment text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE danger_zone_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select danger_zone_commands" ON danger_zone_commands FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners insert danger_zone_commands" ON danger_zone_commands FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update danger_zone_commands" ON danger_zone_commands FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners delete danger_zone_commands" ON danger_zone_commands FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_danger_zone_project ON danger_zone_commands(project_id);
