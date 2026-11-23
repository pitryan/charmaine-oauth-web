-- Enable the authenticated Charmaine MCP user to create draft memories and
-- promote memories it owns. This migration intentionally leaves the existing
-- SELECT policy and legacy canon_status constraint unchanged.
--
-- The grants are column-scoped so callers cannot supply or reassign owner_id.
-- owner_id continues to come from its auth.uid() default.

begin;

alter table public.charmaine_memories enable row level security;

-- Start from no table-wide write privilege. DELETE remains unavailable.
revoke insert, update, delete on table public.charmaine_memories
  from authenticated;

-- Table-level revocation does not remove historical column grants. Revoke
-- every write column explicitly before adding the narrow allowlist below.
revoke insert (
  id, memory_key, title, memory_text, perspective, period, school_year,
  event_year, category, people, tags, emotion, clarity, origin, canon_status,
  importance, details, created_at, owner_id
) on public.charmaine_memories from authenticated;
revoke update (
  id, memory_key, title, memory_text, perspective, period, school_year,
  event_year, category, people, tags, emotion, clarity, origin, canon_status,
  importance, details, created_at, owner_id
) on public.charmaine_memories from authenticated;

-- New rows use the database defaults for id, owner_id, created_at, and
-- canon_status. In particular, authenticated callers cannot insert canon rows.
grant insert (
  memory_key,
  title,
  memory_text,
  perspective,
  period,
  school_year,
  event_year,
  category,
  people,
  tags,
  emotion,
  clarity,
  origin,
  importance,
  details
) on public.charmaine_memories to authenticated;

-- The first write API only needs to promote status and record promotion
-- metadata. Other editorial fields stay read-only until a reviewed tool needs
-- them.
grant update (canon_status, details)
  on public.charmaine_memories to authenticated;

-- Idempotency is scoped per owner. Existing rows without an idempotency key
-- are unaffected, while concurrent retries for the same owner cannot create
-- duplicate memories.
create unique index if not exists
  charmaine_memories_owner_idempotency_key_uidx
  on public.charmaine_memories (
    owner_id,
    ((details ->> 'idempotency_key'))
  )
  where nullif(details ->> 'idempotency_key', '') is not null;

drop policy if exists charmaine_owner_insert on public.charmaine_memories;
create policy charmaine_owner_insert
  on public.charmaine_memories
  for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and nullif((select auth.jwt() ->> 'client_id'), '') is not null
    and canon_status = 'draft'
  );

drop policy if exists charmaine_owner_update on public.charmaine_memories;
create policy charmaine_owner_update
  on public.charmaine_memories
  for update
  to authenticated
  using (
    owner_id = (select auth.uid())
    and nullif((select auth.jwt() ->> 'client_id'), '') is not null
    and canon_status = 'draft'
  )
  with check (
    owner_id = (select auth.uid())
    and nullif((select auth.jwt() ->> 'client_id'), '') is not null
    and canon_status = 'canon'
  );

commit;

-- Verification after applying:
--   * authenticated has SELECT plus column-scoped INSERT/UPDATE, but no DELETE.
--   * INSERT without owner_id creates a draft owned by auth.uid().
--   * INSERT with owner_id, INSERT with canon_status, and owner_id UPDATE fail.
--   * UPDATE can only promote a caller-owned draft to canon while carrying an
--     OAuth client_id; canon and legacy-status rows remain immutable.
--   * Repeated idempotency keys are rejected only within the same owner.
-- Inspect column grants with information_schema.column_privileges; the
-- information_schema.role_table_grants view only reports table-level grants.
--
-- Manual rollback (do not run as part of this migration):
--   revoke insert (
--     memory_key, title, memory_text, perspective, period, school_year,
--     event_year, category, people, tags, emotion, clarity, origin, importance,
--     details
--   ) on public.charmaine_memories from authenticated;
--   revoke update (canon_status, details)
--     on public.charmaine_memories from authenticated;
--   drop policy if exists charmaine_owner_insert on public.charmaine_memories;
--   drop policy if exists charmaine_owner_update on public.charmaine_memories;
--   drop index if exists
--     public.charmaine_memories_owner_idempotency_key_uidx;
