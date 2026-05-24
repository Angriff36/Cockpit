-- Emergency cleanup script for duplicate entries
-- This removes duplicate ports, commands, env_keys, deployments, and docker configs
-- keeping only the first occurrence of each unique item

-- Clean up duplicate ports (using DISTINCT ON)
WITH ranked_ports AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id, port, protocol ORDER BY created_at) as rn
    FROM project_ports
)
DELETE FROM project_ports
WHERE id IN (SELECT id FROM ranked_ports WHERE rn > 1);

-- Clean up duplicate commands (using DISTINCT ON)
WITH ranked_commands AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id, name, command ORDER BY created_at) as rn
    FROM command_profiles
)
DELETE FROM command_profiles
WHERE id IN (SELECT id FROM ranked_commands WHERE rn > 1);

-- Clean up duplicate env_keys (using DISTINCT ON)
WITH ranked_env_keys AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id, key_name ORDER BY created_at) as rn
    FROM env_keys
)
DELETE FROM env_keys
WHERE id IN (SELECT id FROM ranked_env_keys WHERE rn > 1);

-- Clean up duplicate deployments (using DISTINCT ON)
WITH ranked_deployments AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id, platform, environment ORDER BY created_at) as rn
    FROM deployment_targets
)
DELETE FROM deployment_targets
WHERE id IN (SELECT id FROM ranked_deployments WHERE rn > 1);

-- Clean up duplicate docker configs (using DISTINCT ON)
WITH ranked_docker AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id, compose_file_path ORDER BY created_at) as rn
    FROM docker_compose_configs
)
DELETE FROM docker_compose_configs
WHERE id IN (SELECT id FROM ranked_docker WHERE rn > 1);

-- Show remaining counts
SELECT 'command_profiles' as table_name, COUNT(*) as count FROM command_profiles
UNION ALL
SELECT 'project_ports' as table_name, COUNT(*) as count FROM project_ports
UNION ALL
SELECT 'env_keys' as table_name, COUNT(*) as count FROM env_keys
UNION ALL
SELECT 'deployment_targets' as table_name, COUNT(*) as count FROM deployment_targets
UNION ALL
SELECT 'docker_compose_configs' as table_name, COUNT(*) as count FROM docker_compose_configs;