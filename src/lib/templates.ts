import type { ProjectTemplate } from './types';

/**
 * Pre-built project configuration templates for common stack combinations.
 * Each template pre-populates commands, ports, env key scaffolds, and other
 * configuration when creating a new project.
 */
export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  // ── Next.js + Supabase ──────────────────────────────────────────────────────
  {
    id: 'nextjs-supabase',
    name: 'Next.js + Supabase',
    description: 'Full-stack app with Next.js frontend and Supabase backend (auth, DB, storage)',
    icon: 'Globe',
    tags: 'nextjs, supabase, fullstack',
    package_manager: 'npm',
    hosting_platform: 'vercel',
    commands: [
      { name: 'Dev server', kind: 'dev', command: 'npm run dev', working_dir: '', expected_port: 3000, health_url: 'http://localhost:3000', notes: '', must_confirm: false },
      { name: 'Build', kind: 'build', command: 'npm run build', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
      { name: 'Lint', kind: 'lint', command: 'npm run lint', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
      { name: 'Supabase start', kind: 'dev', command: 'npx supabase start', working_dir: '', expected_port: 54321, health_url: 'http://localhost:54321/rest/v1/', notes: 'Starts local Supabase stack', must_confirm: false },
      { name: 'Supabase stop', kind: 'reset', command: 'npx supabase stop', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: true },
      { name: 'Generate types', kind: 'other', command: 'npx supabase gen types typescript --local > src/lib/database.types.ts', working_dir: '', expected_port: null, health_url: '', notes: 'Regenerate TypeScript types from DB schema', must_confirm: false },
      { name: 'DB push', kind: 'migrate', command: 'npx supabase db push', working_dir: '', expected_port: null, health_url: '', notes: 'Push migrations to remote', must_confirm: true },
      { name: 'DB reset', kind: 'reset', command: 'npx supabase db reset', working_dir: '', expected_port: null, health_url: '', notes: 'Reset local database', must_confirm: true },
    ],
    ports: [
      { label: 'Next.js dev', port: 3000, protocol: 'http', local_url: 'http://localhost:3000', health_url: 'http://localhost:3000', notes: '' },
      { label: 'Supabase API', port: 54321, protocol: 'http', local_url: 'http://localhost:54321', health_url: 'http://localhost:54321/rest/v1/', notes: '' },
      { label: 'Supabase Studio', port: 54323, protocol: 'http', local_url: 'http://localhost:54323', health_url: '', notes: 'Database management UI' },
      { label: 'Supabase Inbucket', port: 54324, protocol: 'http', local_url: 'http://localhost:54324', health_url: '', notes: 'Email testing' },
    ],
    env_keys: [
      { key_name: 'NEXT_PUBLIC_SUPABASE_URL', purpose: 'Supabase project URL', classification: 'client-public', source_type: 'env', infisical_path: '', env_scope: 'all', required: true, notes: '' },
      { key_name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', purpose: 'Supabase anonymous/public key', classification: 'client-public', source_type: 'env', infisical_path: '', env_scope: 'all', required: true, notes: '' },
      { key_name: 'SUPABASE_SERVICE_ROLE_KEY', purpose: 'Supabase service role key (server-side only)', classification: 'server-runtime', source_type: 'env', infisical_path: '', env_scope: 'server', required: true, notes: 'Never expose to client' },
      { key_name: 'SUPABASE_DB_URL', purpose: 'Direct Postgres connection string', classification: 'server-runtime', source_type: 'env', infisical_path: '', env_scope: 'server', required: false, notes: '' },
    ],
    urls: [],
    deployments: [
      { platform: 'vercel', platform_project_id: '', platform_project_name: '', team_or_org: '', environment: 'production', branch: 'main', region: '', deploy_command: '', build_command: 'npm run build', production_url: '', preview_url_pattern: '', dashboard_url: '', logs_url: '', domains: '', env_source: 'vercel', notes: '' },
    ],
    docker: [],
  },

  // ── NestJS API ─────────────────────────────────────────────────────────────
  {
    id: 'nestjs-api',
    name: 'NestJS API',
    description: 'Backend API service with NestJS, TypeORM/Prisma, and structured modules',
    icon: 'Server',
    tags: 'nestjs, api, backend, typescript',
    package_manager: 'npm',
    hosting_platform: 'railway',
    commands: [
      { name: 'Dev server', kind: 'dev', command: 'npm run start:dev', working_dir: '', expected_port: 3000, health_url: 'http://localhost:3000/health', notes: 'Hot-reload dev server', must_confirm: false },
      { name: 'Build', kind: 'build', command: 'npm run build', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
      { name: 'Start prod', kind: 'start', command: 'npm run start:prod', working_dir: '', expected_port: 3000, health_url: 'http://localhost:3000/health', notes: '', must_confirm: false },
      { name: 'Test', kind: 'test', command: 'npm run test', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
      { name: 'Test e2e', kind: 'test', command: 'npm run test:e2e', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
      { name: 'Lint', kind: 'lint', command: 'npm run lint', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
      { name: 'Migrate', kind: 'migrate', command: 'npm run migration:run', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: true },
      { name: 'Seed', kind: 'seed', command: 'npm run seed', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
    ],
    ports: [
      { label: 'API server', port: 3000, protocol: 'http', local_url: 'http://localhost:3000', health_url: 'http://localhost:3000/health', notes: '' },
    ],
    env_keys: [
      { key_name: 'DATABASE_URL', purpose: 'PostgreSQL connection string', classification: 'server-runtime', source_type: 'env', infisical_path: '', env_scope: 'server', required: true, notes: '' },
      { key_name: 'JWT_SECRET', purpose: 'JWT signing secret', classification: 'server-runtime', source_type: 'env', infisical_path: '', env_scope: 'server', required: true, notes: '' },
      { key_name: 'PORT', purpose: 'Server listen port', classification: 'server-runtime', source_type: 'env', infisical_path: '', env_scope: 'server', required: false, notes: 'Defaults to 3000' },
      { key_name: 'NODE_ENV', purpose: 'Runtime environment', classification: 'server-runtime', source_type: 'env', infisical_path: '', env_scope: 'server', required: false, notes: '' },
    ],
    urls: [],
    deployments: [],
    docker: [],
  },

  // ── Astro Static Site ──────────────────────────────────────────────────────
  {
    id: 'astro-site',
    name: 'Astro Site',
    description: 'Static site or content-driven website with Astro framework',
    icon: 'Rocket',
    tags: 'astro, static, website',
    package_manager: 'npm',
    hosting_platform: 'vercel',
    commands: [
      { name: 'Dev server', kind: 'dev', command: 'npm run dev', working_dir: '', expected_port: 4321, health_url: 'http://localhost:4321', notes: '', must_confirm: false },
      { name: 'Build', kind: 'build', command: 'npm run build', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
      { name: 'Preview', kind: 'start', command: 'npm run preview', working_dir: '', expected_port: 4321, health_url: 'http://localhost:4321', notes: 'Preview production build locally', must_confirm: false },
    ],
    ports: [
      { label: 'Astro dev', port: 4321, protocol: 'http', local_url: 'http://localhost:4321', health_url: 'http://localhost:4321', notes: '' },
    ],
    env_keys: [
      { key_name: 'PUBLIC_SITE_URL', purpose: 'Public-facing site URL', classification: 'client-public', source_type: 'env', infisical_path: '', env_scope: 'all', required: false, notes: '' },
    ],
    urls: [],
    deployments: [
      { platform: 'vercel', platform_project_id: '', platform_project_name: '', team_or_org: '', environment: 'production', branch: 'main', region: '', deploy_command: '', build_command: 'npm run build', production_url: '', preview_url_pattern: '', dashboard_url: '', logs_url: '', domains: '', env_source: 'vercel', notes: '' },
    ],
    docker: [],
  },

  // ── React + Vite SPA ───────────────────────────────────────────────────────
  {
    id: 'react-vite',
    name: 'React + Vite',
    description: 'Single-page application with React, Vite, and Tailwind CSS',
    icon: 'Layers',
    tags: 'react, vite, spa, tailwind',
    package_manager: 'npm',
    hosting_platform: 'vercel',
    commands: [
      { name: 'Dev server', kind: 'dev', command: 'npm run dev', working_dir: '', expected_port: 5173, health_url: 'http://localhost:5173', notes: '', must_confirm: false },
      { name: 'Build', kind: 'build', command: 'npm run build', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
      { name: 'Preview', kind: 'start', command: 'npm run preview', working_dir: '', expected_port: 4173, health_url: 'http://localhost:4173', notes: '', must_confirm: false },
      { name: 'Test', kind: 'test', command: 'npm run test', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
      { name: 'Lint', kind: 'lint', command: 'npm run lint', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
    ],
    ports: [
      { label: 'Vite dev', port: 5173, protocol: 'http', local_url: 'http://localhost:5173', health_url: 'http://localhost:5173', notes: '' },
    ],
    env_keys: [
      { key_name: 'VITE_API_URL', purpose: 'Backend API base URL', classification: 'client-public', source_type: 'env', infisical_path: '', env_scope: 'all', required: false, notes: '' },
    ],
    urls: [],
    deployments: [],
    docker: [],
  },

  // ── Express + PostgreSQL ───────────────────────────────────────────────────
  {
    id: 'express-postgres',
    name: 'Express + PostgreSQL',
    description: 'REST API with Express.js, PostgreSQL, and Docker Compose for local DB',
    icon: 'Database',
    tags: 'express, postgres, api, docker',
    package_manager: 'npm',
    hosting_platform: 'railway',
    commands: [
      { name: 'Dev server', kind: 'dev', command: 'npm run dev', working_dir: '', expected_port: 4000, health_url: 'http://localhost:4000/health', notes: '', must_confirm: false },
      { name: 'Build', kind: 'build', command: 'npm run build', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
      { name: 'Start', kind: 'start', command: 'npm start', working_dir: '', expected_port: 4000, health_url: 'http://localhost:4000/health', notes: '', must_confirm: false },
      { name: 'Test', kind: 'test', command: 'npm test', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
      { name: 'Migrate', kind: 'migrate', command: 'npm run migrate', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: true },
      { name: 'Seed', kind: 'seed', command: 'npm run seed', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
      { name: 'Docker up', kind: 'dev', command: 'docker compose up -d', working_dir: '', expected_port: 5432, health_url: '', notes: 'Start PostgreSQL container', must_confirm: false },
      { name: 'Docker down', kind: 'reset', command: 'docker compose down', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: true },
    ],
    ports: [
      { label: 'API server', port: 4000, protocol: 'http', local_url: 'http://localhost:4000', health_url: 'http://localhost:4000/health', notes: '' },
      { label: 'PostgreSQL', port: 5432, protocol: 'http', local_url: '', health_url: '', notes: 'Local Docker PostgreSQL' },
    ],
    env_keys: [
      { key_name: 'DATABASE_URL', purpose: 'PostgreSQL connection string', classification: 'server-runtime', source_type: 'env', infisical_path: '', env_scope: 'server', required: true, notes: 'e.g. postgres://user:pass@localhost:5432/mydb' },
      { key_name: 'PORT', purpose: 'Server listen port', classification: 'server-runtime', source_type: 'env', infisical_path: '', env_scope: 'server', required: false, notes: 'Defaults to 4000' },
      { key_name: 'JWT_SECRET', purpose: 'JWT signing secret', classification: 'server-runtime', source_type: 'env', infisical_path: '', env_scope: 'server', required: true, notes: '' },
      { key_name: 'NODE_ENV', purpose: 'Runtime environment', classification: 'server-runtime', source_type: 'env', infisical_path: '', env_scope: 'server', required: false, notes: '' },
    ],
    urls: [],
    deployments: [],
    docker: [
      { compose_file_path: 'docker-compose.yml', compose_project_name: '', services: 'postgres', notes: 'Local PostgreSQL for development' },
    ],
  },

  // ── Python FastAPI ─────────────────────────────────────────────────────────
  {
    id: 'fastapi',
    name: 'Python FastAPI',
    description: 'Async Python API with FastAPI, uvicorn, and SQLAlchemy',
    icon: 'Zap',
    tags: 'python, fastapi, api, async',
    package_manager: 'pip',
    hosting_platform: 'fly',
    commands: [
      { name: 'Dev server', kind: 'dev', command: 'uvicorn app.main:app --reload --port 8000', working_dir: '', expected_port: 8000, health_url: 'http://localhost:8000/health', notes: '', must_confirm: false },
      { name: 'Test', kind: 'test', command: 'pytest', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
      { name: 'Lint', kind: 'lint', command: 'ruff check .', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
      { name: 'Format', kind: 'other', command: 'ruff format .', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
      { name: 'Migrate', kind: 'migrate', command: 'alembic upgrade head', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: true },
      { name: 'Create migration', kind: 'migrate', command: 'alembic revision --autogenerate -m ""', working_dir: '', expected_port: null, health_url: '', notes: 'Add message in quotes', must_confirm: false },
    ],
    ports: [
      { label: 'FastAPI', port: 8000, protocol: 'http', local_url: 'http://localhost:8000', health_url: 'http://localhost:8000/health', notes: '' },
    ],
    env_keys: [
      { key_name: 'DATABASE_URL', purpose: 'PostgreSQL connection string', classification: 'server-runtime', source_type: 'env', infisical_path: '', env_scope: 'server', required: true, notes: '' },
      { key_name: 'SECRET_KEY', purpose: 'App secret key for signing', classification: 'server-runtime', source_type: 'env', infisical_path: '', env_scope: 'server', required: true, notes: '' },
      { key_name: 'CORS_ORIGINS', purpose: 'Allowed CORS origins (comma-separated)', classification: 'server-runtime', source_type: 'env', infisical_path: '', env_scope: 'server', required: false, notes: '' },
    ],
    urls: [
      { label: 'API docs', url: 'http://localhost:8000/docs', category: 'documentation', environment: 'local', notes: 'Swagger UI' },
      { label: 'ReDoc', url: 'http://localhost:8000/redoc', category: 'documentation', environment: 'local', notes: 'Alternative API docs' },
    ],
    deployments: [],
    docker: [],
  },

  // ── Monorepo (Turborepo) ───────────────────────────────────────────────────
  {
    id: 'turborepo',
    name: 'Turborepo Monorepo',
    description: 'Monorepo with Turborepo for multiple packages and apps',
    icon: 'GitBranch',
    tags: 'monorepo, turborepo, typescript',
    package_manager: 'pnpm',
    hosting_platform: 'vercel',
    commands: [
      { name: 'Dev all', kind: 'dev', command: 'pnpm dev', working_dir: '', expected_port: null, health_url: '', notes: 'Runs dev for all apps', must_confirm: false },
      { name: 'Build all', kind: 'build', command: 'pnpm build', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
      { name: 'Test all', kind: 'test', command: 'pnpm test', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
      { name: 'Lint all', kind: 'lint', command: 'pnpm lint', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
      { name: 'Clean', kind: 'reset', command: 'pnpm clean', working_dir: '', expected_port: null, health_url: '', notes: 'Remove all node_modules and build artifacts', must_confirm: true },
    ],
    ports: [],
    env_keys: [],
    urls: [],
    deployments: [],
    docker: [],
  },

  // ── Django + PostgreSQL ────────────────────────────────────────────────────
  {
    id: 'django',
    name: 'Django + PostgreSQL',
    description: 'Python web framework with Django, PostgreSQL, and management commands',
    icon: 'Shield',
    tags: 'python, django, fullstack',
    package_manager: 'pip',
    hosting_platform: 'railway',
    commands: [
      { name: 'Dev server', kind: 'dev', command: 'python manage.py runserver 8000', working_dir: '', expected_port: 8000, health_url: 'http://localhost:8000', notes: '', must_confirm: false },
      { name: 'Test', kind: 'test', command: 'python manage.py test', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
      { name: 'Migrate', kind: 'migrate', command: 'python manage.py migrate', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: true },
      { name: 'Make migrations', kind: 'migrate', command: 'python manage.py makemigrations', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
      { name: 'Create superuser', kind: 'other', command: 'python manage.py createsuperuser', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
      { name: 'Collect static', kind: 'build', command: 'python manage.py collectstatic --noinput', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
      { name: 'Shell', kind: 'other', command: 'python manage.py shell', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
    ],
    ports: [
      { label: 'Django dev', port: 8000, protocol: 'http', local_url: 'http://localhost:8000', health_url: 'http://localhost:8000', notes: '' },
    ],
    env_keys: [
      { key_name: 'DATABASE_URL', purpose: 'PostgreSQL connection string', classification: 'server-runtime', source_type: 'env', infisical_path: '', env_scope: 'server', required: true, notes: '' },
      { key_name: 'SECRET_KEY', purpose: 'Django secret key', classification: 'server-runtime', source_type: 'env', infisical_path: '', env_scope: 'server', required: true, notes: '' },
      { key_name: 'DEBUG', purpose: 'Django debug mode', classification: 'server-runtime', source_type: 'env', infisical_path: '', env_scope: 'server', required: false, notes: 'Set to False in production' },
      { key_name: 'ALLOWED_HOSTS', purpose: 'Allowed hostnames (comma-separated)', classification: 'server-runtime', source_type: 'env', infisical_path: '', env_scope: 'server', required: true, notes: '' },
    ],
    urls: [
      { label: 'Admin panel', url: 'http://localhost:8000/admin', category: 'dashboard', environment: 'local', notes: '' },
    ],
    deployments: [],
    docker: [],
  },

  // ── Remix + Supabase ───────────────────────────────────────────────────────
  {
    id: 'remix-supabase',
    name: 'Remix + Supabase',
    description: 'Full-stack Remix app with Supabase for auth, database, and storage',
    icon: 'RefreshCw',
    tags: 'remix, supabase, fullstack',
    package_manager: 'npm',
    hosting_platform: 'fly',
    commands: [
      { name: 'Dev server', kind: 'dev', command: 'npm run dev', working_dir: '', expected_port: 3000, health_url: 'http://localhost:3000', notes: '', must_confirm: false },
      { name: 'Build', kind: 'build', command: 'npm run build', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: false },
      { name: 'Start', kind: 'start', command: 'npm start', working_dir: '', expected_port: 3000, health_url: 'http://localhost:3000', notes: '', must_confirm: false },
      { name: 'Supabase start', kind: 'dev', command: 'npx supabase start', working_dir: '', expected_port: 54321, health_url: '', notes: '', must_confirm: false },
      { name: 'DB push', kind: 'migrate', command: 'npx supabase db push', working_dir: '', expected_port: null, health_url: '', notes: '', must_confirm: true },
    ],
    ports: [
      { label: 'Remix dev', port: 3000, protocol: 'http', local_url: 'http://localhost:3000', health_url: 'http://localhost:3000', notes: '' },
      { label: 'Supabase API', port: 54321, protocol: 'http', local_url: 'http://localhost:54321', health_url: '', notes: '' },
    ],
    env_keys: [
      { key_name: 'SUPABASE_URL', purpose: 'Supabase project URL', classification: 'server-runtime', source_type: 'env', infisical_path: '', env_scope: 'all', required: true, notes: '' },
      { key_name: 'SUPABASE_ANON_KEY', purpose: 'Supabase anonymous key', classification: 'client-public', source_type: 'env', infisical_path: '', env_scope: 'all', required: true, notes: '' },
      { key_name: 'SUPABASE_SERVICE_ROLE_KEY', purpose: 'Supabase service role key', classification: 'server-runtime', source_type: 'env', infisical_path: '', env_scope: 'server', required: true, notes: 'Server-side only' },
      { key_name: 'SESSION_SECRET', purpose: 'Cookie session signing secret', classification: 'server-runtime', source_type: 'env', infisical_path: '', env_scope: 'server', required: true, notes: '' },
    ],
    urls: [],
    deployments: [],
    docker: [],
  },
];
