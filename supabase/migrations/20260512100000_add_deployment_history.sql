/*
  # Deployment History

  Stores a log of deployment events per project.
  Each row captures a single deploy attempt: when it happened, which platform/target,
  how it was triggered, what happened, and the resulting URL.

  Linked to projects (required) and optionally to a specific deployment_target.
*/

CREATE TABLE IF NOT EXISTS deployment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  deployment_target_id uuid REFERENCES deployment_targets(id) ON DELETE SET NULL,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  platform text NOT NULL DEFAULT '',
  environment text NOT NULL DEFAULT '',
  trigger_source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'started',
  deployment_url text NOT NULL DEFAULT '',
  deploy_command text NOT NULL DEFAULT '',
  branch text NOT NULL DEFAULT '',
  commit_sha text NOT NULL DEFAULT '',
  duration_ms integer,
  notes text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE deployment_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select deployment_history" ON deployment_history FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners insert deployment_history" ON deployment_history FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update deployment_history" ON deployment_history FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners delete deployment_history" ON deployment_history FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_deploy_history_project ON deployment_history(project_id);
CREATE INDEX IF NOT EXISTS idx_deploy_history_started ON deployment_history(started_at DESC);
