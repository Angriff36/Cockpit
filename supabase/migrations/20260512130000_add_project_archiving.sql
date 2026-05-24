-- Add archiving support to projects table
-- archived_at: timestamp when the project was archived (null = not archived)
-- archive_snapshot: JSONB snapshot of the project scope at archive time (exportable)

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS archived_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS archive_snapshot jsonb DEFAULT NULL;

-- Index for filtering archived vs active projects efficiently
CREATE INDEX IF NOT EXISTS idx_projects_archived_at ON projects (archived_at)
  WHERE archived_at IS NOT NULL;
