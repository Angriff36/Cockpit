/*
  # Dashboard Layouts

  Stores per-user dashboard layouts allowing drag-and-drop arrangement of
  project cards into named sections with configurable card sizes.

  Layout config is a JSONB array of sections, each containing:
  - name: section display name (e.g. 'Client Work', 'Personal')
  - project_ids: ordered array of project UUIDs
  - card_size: 'small' | 'medium' | 'large' (default 'medium')

  Only one layout per user (upsert on owner_id).
*/

CREATE TABLE IF NOT EXISTS dashboard_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL DEFAULT 'Default Layout',
  layout_config jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_owner_layout UNIQUE (owner_id)
);

ALTER TABLE dashboard_layouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select layouts" ON dashboard_layouts FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners insert layouts" ON dashboard_layouts FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update layouts" ON dashboard_layouts FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners delete layouts" ON dashboard_layouts FOR DELETE TO authenticated USING (auth.uid() = owner_id);
