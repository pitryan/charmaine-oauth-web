-- LOCAL INTEGRATION TEST MODEL ONLY.
-- Derived from the project context, not a verified production schema snapshot.
-- This migration belongs only to the isolated tests/integration Supabase project.

create table public.charmaine_memories (
  id uuid primary key default gen_random_uuid(),
  memory_key text not null unique,
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  title text not null,
  memory_text text not null,
  perspective text not null default 'charmaine',
  period text,
  school_year text not null,
  event_year integer,
  category text not null,
  people text[] not null default '{}',
  tags text[] not null default '{}',
  emotion text,
  clarity text not null default 'unspecified',
  origin text not null default 'synthetic_local_integration',
  canon_status text not null default 'draft'
    check (canon_status in ('draft', 'canon', 'archived', 'au')),
  importance integer not null default 1
    check (importance between 1 and 5),
  details jsonb not null default '{"synthetic":true}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.charmaine_memories is
  'Synthetic local integration test model; not production schema verification';

create index charmaine_memories_owner_id_idx
  on public.charmaine_memories(owner_id);

alter table public.charmaine_memories enable row level security;
alter table public.charmaine_memories force row level security;

revoke all on table public.charmaine_memories
  from public, anon, authenticated;
grant select on table public.charmaine_memories to authenticated;

-- The local runner uses these privileges only to bootstrap synthetic fixtures.
-- Retrieval tests and the MCP runtime receive authenticated user tokens instead.
revoke all on table public.charmaine_memories from service_role;
grant select, insert, delete on table public.charmaine_memories to service_role;

create policy local_owner_oauth_read
  on public.charmaine_memories
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    and nullif((select auth.jwt() ->> 'client_id'), '') is not null
  );
