/*
  # Multi-Machine Configuration Sync

  Enables project configurations to sync across multiple development machines.
  Machine-specific overrides (local paths, port offsets) are stored separately
  from shared config. Machine identity is detected via hostname.

  1. New Tables
    - `machines`          - registered development machines per user
    - `machine_overrides` - per-project, per-machine configuration overrides

  2. Security
    - RLS enabled, scoped to owner_id = auth.uid()
*/

-- ── machines ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  hostname text NOT NULL DEFAULT '',
  label text NOT NULL DEFAULT '',
  os text NOT NULL DEFAULT '',
  arch text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  is_current boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(owner_id, hostname)
);

ALTER TABLE machines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select machines" ON machines FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners insert machines" ON machines FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update machines" ON machines FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners delete machines" ON machines FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_machines_owner ON machines(owner_id);

-- ── machine_overrides ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS machine_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  machine_id uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  repo_path text NOT NULL DEFAULT '',
  port_offset integer NOT NULL DEFAULT 0,
  working_dir_override text NOT NULL DEFAULT '',
  custom_env text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(project_id, machine_id)
);

ALTER TABLE machine_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select machine_overrides" ON machine_overrides FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners insert machine_overrides" ON machine_overrides FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update machine_overrides" ON machine_overrides FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners delete machine_overrides" ON machine_overrides FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_mo_project ON machine_overrides(project_id);
CREATE INDEX IF NOT EXISTS idx_mo_machine ON machine_overrides(machine_id);
