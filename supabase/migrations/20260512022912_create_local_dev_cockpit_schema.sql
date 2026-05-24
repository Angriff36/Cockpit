/*
  # Local Dev Cockpit Schema

  1. New Tables
    - `projects` - core project identity (name, slug, repo path, package manager, status, notes, tags)
    - `command_profiles` - saved dev/build/test/migrate commands per project
    - `project_ports` - expected local ports with labels, protocol, health URL
    - `project_urls` - labeled URLs (local, prod, dashboards, docs)
    - `deployment_targets` - platform, env, deploy command, production/preview URLs
    - `env_keys` - expected env key names with purpose/classification (no values stored)
    - `infisical_refs` - Infisical project IDs, env names, secret paths
    - `docker_compose_configs` - compose file paths, project name, services list
    - `launch_groups` - ordered startup groups
    - `launch_group_steps` - steps in a launch group
    - `agent_context_overrides` - per-project agent context additions (warnings, gotchas, danger, must-confirm)

  2. Security
    - RLS enabled on all tables
    - Policies scoped to authenticated user via `owner_id = auth.uid()`
    - No secret values ever stored
*/

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  slug text NOT NULL,
  name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  repo_path text NOT NULL DEFAULT '',
  repo_url text NOT NULL DEFAULT '',
  package_manager text NOT NULL DEFAULT 'npm',
  default_branch text NOT NULL DEFAULT 'main',
  monorepo_paths text NOT NULL DEFAULT '',
  tags text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  notes text NOT NULL DEFAULT '',
  danger_notes text NOT NULL DEFAULT '',
  hosting_platform text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(owner_id, slug)
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select projects" ON projects FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners insert projects" ON projects FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update projects" ON projects FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners delete projects" ON projects FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE TABLE IF NOT EXISTS command_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'dev',
  command text NOT NULL DEFAULT '',
  working_dir text NOT NULL DEFAULT '',
  expected_port integer,
  health_url text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  must_confirm boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE command_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select commands" ON command_profiles FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners insert commands" ON command_profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update commands" ON command_profiles FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners delete commands" ON command_profiles FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE TABLE IF NOT EXISTS project_ports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  label text NOT NULL DEFAULT '',
  port integer NOT NULL DEFAULT 0,
  protocol text NOT NULL DEFAULT 'http',
  local_url text NOT NULL DEFAULT '',
  health_url text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE project_ports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select ports" ON project_ports FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners insert ports" ON project_ports FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update ports" ON project_ports FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners delete ports" ON project_ports FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE TABLE IF NOT EXISTS project_urls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  label text NOT NULL DEFAULT '',
  url text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'other',
  environment text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE project_urls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select urls" ON project_urls FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners insert urls" ON project_urls FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update urls" ON project_urls FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners delete urls" ON project_urls FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE TABLE IF NOT EXISTS deployment_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  platform text NOT NULL DEFAULT 'vercel',
  platform_project_id text NOT NULL DEFAULT '',
  platform_project_name text NOT NULL DEFAULT '',
  team_or_org text NOT NULL DEFAULT '',
  environment text NOT NULL DEFAULT 'production',
  branch text NOT NULL DEFAULT '',
  region text NOT NULL DEFAULT '',
  deploy_command text NOT NULL DEFAULT '',
  build_command text NOT NULL DEFAULT '',
  production_url text NOT NULL DEFAULT '',
  preview_url_pattern text NOT NULL DEFAULT '',
  dashboard_url text NOT NULL DEFAULT '',
  logs_url text NOT NULL DEFAULT '',
  domains text NOT NULL DEFAULT '',
  env_source text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE deployment_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select deployments" ON deployment_targets FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners insert deployments" ON deployment_targets FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update deployments" ON deployment_targets FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners delete deployments" ON deployment_targets FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE TABLE IF NOT EXISTS env_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  key_name text NOT NULL DEFAULT '',
  purpose text NOT NULL DEFAULT '',
  classification text NOT NULL DEFAULT 'server-runtime',
  source_type text NOT NULL DEFAULT 'infisical',
  infisical_path text NOT NULL DEFAULT '',
  env_scope text NOT NULL DEFAULT '',
  required boolean NOT NULL DEFAULT true,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE env_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select env_keys" ON env_keys FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners insert env_keys" ON env_keys FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update env_keys" ON env_keys FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners delete env_keys" ON env_keys FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE TABLE IF NOT EXISTS infisical_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  infisical_project_id text NOT NULL DEFAULT '',
  workspace_name text NOT NULL DEFAULT '',
  environment text NOT NULL DEFAULT 'dev',
  secret_path text NOT NULL DEFAULT '/',
  run_command_pattern text NOT NULL DEFAULT 'infisical run -- ',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE infisical_refs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select infisical" ON infisical_refs FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners insert infisical" ON infisical_refs FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update infisical" ON infisical_refs FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners delete infisical" ON infisical_refs FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE TABLE IF NOT EXISTS docker_compose_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  compose_file_path text NOT NULL DEFAULT 'docker-compose.yml',
  compose_project_name text NOT NULL DEFAULT '',
  services text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE docker_compose_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select docker" ON docker_compose_configs FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners insert docker" ON docker_compose_configs FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update docker" ON docker_compose_configs FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners delete docker" ON docker_compose_configs FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE TABLE IF NOT EXISTS launch_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE launch_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select groups" ON launch_groups FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners insert groups" ON launch_groups FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update groups" ON launch_groups FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners delete groups" ON launch_groups FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE TABLE IF NOT EXISTS agent_context_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  database_notes text NOT NULL DEFAULT '',
  migration_notes text NOT NULL DEFAULT '',
  danger_zones text NOT NULL DEFAULT '',
  gotchas text NOT NULL DEFAULT '',
  recommended_commands text NOT NULL DEFAULT '',
  must_confirm_commands text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now(),
  UNIQUE(project_id)
);

ALTER TABLE agent_context_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select overrides" ON agent_context_overrides FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners insert overrides" ON agent_context_overrides FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update overrides" ON agent_context_overrides FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners delete overrides" ON agent_context_overrides FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_cmd_project ON command_profiles(project_id);
CREATE INDEX IF NOT EXISTS idx_ports_project ON project_ports(project_id);
CREATE INDEX IF NOT EXISTS idx_urls_project ON project_urls(project_id);
CREATE INDEX IF NOT EXISTS idx_deploy_project ON deployment_targets(project_id);
CREATE INDEX IF NOT EXISTS idx_env_project ON env_keys(project_id);
CREATE INDEX IF NOT EXISTS idx_infi_project ON infisical_refs(project_id);
CREATE INDEX IF NOT EXISTS idx_docker_project ON docker_compose_configs(project_id);
