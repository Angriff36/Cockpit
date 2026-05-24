/*
  # Project Activity Log

  Stores a chronological log of significant events per project:
  daemon start/stop, sync runs, field updates, CLI commands, etc.
  Each row captures a single event with its type, actor, and optional metadata.

  Linked to projects (required).
*/

CREATE TABLE IF NOT EXISTS project_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  event_type text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'general',
  title text NOT NULL DEFAULT '',
  detail text NOT NULL DEFAULT '',
  metadata jsonb DEFAULT '{}',
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE project_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select project_activity_log" ON project_activity_log FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners insert project_activity_log" ON project_activity_log FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners delete project_activity_log" ON project_activity_log FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_activity_log_project ON project_activity_log(project_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON project_activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_category ON project_activity_log(project_id, category);
