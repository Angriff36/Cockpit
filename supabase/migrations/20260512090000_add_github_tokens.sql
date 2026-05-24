-- Store GitHub OAuth access tokens for authenticated users.
-- These tokens are captured from the Supabase OAuth provider_token
-- and used to make authenticated GitHub API calls.

create table if not exists github_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  access_token text not null,
  github_username text not null default '',
  github_avatar_url text not null default '',
  scopes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint github_tokens_owner_unique unique (owner_id)
);

alter table github_tokens enable row level security;

create policy "owner_all" on github_tokens
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create index idx_github_tokens_owner on github_tokens (owner_id);
