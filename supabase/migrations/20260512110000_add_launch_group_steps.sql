/*
  # Launch Group Steps

  Steps within a launch group define ordered startup sequences.
  Each step references a command_profile and includes delay, sort_order,
  and optional conditions (wait_for_port, wait_for_health) to gate
  progression to the next step.
*/

CREATE TABLE IF NOT EXISTS launch_group_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_group_id uuid NOT NULL REFERENCES launch_groups(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  command_id uuid REFERENCES command_profiles(id) ON DELETE SET NULL,
  sort_order int NOT NULL DEFAULT 0,
  delay_ms int NOT NULL DEFAULT 0,
  wait_for_port int,
  wait_for_health text NOT NULL DEFAULT '',
  label text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE launch_group_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select launch_group_steps" ON launch_group_steps FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners insert launch_group_steps" ON launch_group_steps FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update launch_group_steps" ON launch_group_steps FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners delete launch_group_steps" ON launch_group_steps FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_launch_group_steps_group ON launch_group_steps(launch_group_id);
