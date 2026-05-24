/*
  # Agent Context Snapshots

  Stores versioned snapshots of the generated agent context JSON.
  Created automatically when the context is copied or exported.
  Enables diffing between versions to see what changed in project scope.

  1. New Table
    - `agent_context_snapshots` - timestamped JSON snapshots of agent context per project

  2. Security
    - RLS enabled, scoped to owner_id = auth.uid()
*/

CREATE TABLE IF NOT EXISTS agent_context_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  context_json jsonb NOT NULL,
  label text NOT NULL DEFAULT '',
  trigger text NOT NULL DEFAULT 'manual',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE agent_context_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select snapshots" ON agent_context_snapshots FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners insert snapshots" ON agent_context_snapshots FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners delete snapshots" ON agent_context_snapshots FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_snapshots_project ON agent_context_snapshots(project_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_created ON agent_context_snapshots(project_id, created_at DESC);
