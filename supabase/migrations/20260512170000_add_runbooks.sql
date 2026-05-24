-- Runbooks: structured step-by-step operational guides per project
-- Each runbook has ordered steps with optional danger warnings

CREATE TABLE IF NOT EXISTS runbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE runbooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all_runbooks"
  ON runbooks FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE INDEX idx_runbooks_project ON runbooks(project_id, created_at DESC);

-- Runbook Steps: ordered steps within a runbook
CREATE TABLE IF NOT EXISTS runbook_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runbook_id uuid NOT NULL REFERENCES runbooks(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  sort_order integer NOT NULL DEFAULT 0,
  instruction text NOT NULL DEFAULT '',
  is_danger boolean NOT NULL DEFAULT false,
  danger_warning text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE runbook_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all_runbook_steps"
  ON runbook_steps FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE INDEX idx_runbook_steps_runbook ON runbook_steps(runbook_id, sort_order);
