/*
  # Agent Context Share Links

  Stores time-limited, token-protected shareable links for agent context JSON.
  Each link has a unique token that can be used to access the context without login.

  1. New Table
    - `context_share_links` - token-protected, time-limited share links for agent context

  2. Security
    - RLS enabled, scoped to owner_id = auth.uid()
    - Public read access via token lookup (service role only)

  3. Indexes
    - Unique index on token for fast lookups
    - Index on project_id for listing shares per project
*/

CREATE TABLE IF NOT EXISTS context_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  token text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  label text NOT NULL DEFAULT '',
  expires_at timestamptz,
  max_access_count integer,
  access_count integer NOT NULL DEFAULT 0,
  last_accessed_at timestamptz,
  context_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE context_share_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage share links" ON context_share_links
  FOR ALL TO authenticated USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_context_share_links_token ON context_share_links(token);
CREATE INDEX IF NOT EXISTS idx_context_share_links_project ON context_share_links(project_id, created_at DESC);
