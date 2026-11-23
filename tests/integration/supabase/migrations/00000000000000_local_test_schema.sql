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
  school_year text,
  event_year smallint,
  category text not null default 'slice_of_life',
  people text[] not null default '{}',
  tags text[] not null default '{}',
  emotion text,
  clarity text not null default 'clear',
  origin text not null default 'original_fiction',
  canon_status text not null default 'draft'
    check (canon_status in ('draft', 'canon', 'archived', 'au')),
  importance smallint not null default 3
    check (importance between 1 and 5),
  details jsonb not null default '{}'::jsonb,
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
revoke insert (
  id, memory_key, owner_id, title, memory_text, perspective, period,
  school_year, event_year, category, people, tags, emotion, clarity, origin,
  canon_status, importance, details, created_at
) on public.charmaine_memories from authenticated;
revoke update (
  id, memory_key, owner_id, title, memory_text, perspective, period,
  school_year, event_year, category, people, tags, emotion, clarity, origin,
  canon_status, importance, details, created_at
) on public.charmaine_memories from authenticated;
grant select on table public.charmaine_memories to authenticated;
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
grant update (canon_status, details)
  on public.charmaine_memories to authenticated;

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

create policy local_owner_oauth_insert
  on public.charmaine_memories
  for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and nullif((select auth.jwt() ->> 'client_id'), '') is not null
    and canon_status = 'draft'
    and coalesce(details ->> 'memory_type', 'event')
      in ('event', 'fact', 'state')
    and details ->> 'expected_at' is null
  );

create policy local_owner_oauth_promote
  on public.charmaine_memories
  for update
  to authenticated
  using (
    owner_id = (select auth.uid())
    and nullif((select auth.jwt() ->> 'client_id'), '') is not null
    and canon_status = 'draft'
    and coalesce(details ->> 'memory_type', 'event')
      in ('event', 'fact', 'state')
    and details ->> 'expected_at' is null
  )
  with check (
    owner_id = (select auth.uid())
    and nullif((select auth.jwt() ->> 'client_id'), '') is not null
    and canon_status = 'canon'
    and coalesce(details ->> 'memory_type', 'event')
      in ('event', 'fact', 'state')
    and details ->> 'expected_at' is null
  );

create unique index charmaine_memories_owner_idempotency_key_uidx
  on public.charmaine_memories (
    owner_id,
    ((details ->> 'idempotency_key'))
  )
  where nullif(details ->> 'idempotency_key', '') is not null;

create or replace function public.correct_charmaine_memory(
  p_memory_key text,
  p_expected_title text,
  p_confirmation text,
  p_changes jsonb
)
returns table (
  memory_key text,
  title text,
  canon_status text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_client_id text := nullif(auth.jwt() ->> 'client_id', '');
  v_changes jsonb := coalesce(p_changes, '{}'::jsonb);
  v_details_patch jsonb := '{}'::jsonb;
  v_details jsonb;
  v_memory_type text;
  v_event_year smallint;
  v_importance smallint;
  v_row public.charmaine_memories%rowtype;
begin
  if v_uid is null or v_client_id is null then
    raise exception using errcode = '42501', message = 'Akses ditolak.';
  end if;

  if p_memory_key is null or btrim(p_memory_key) = ''
    or char_length(p_memory_key) > 160
    or p_expected_title is null or btrim(p_expected_title) = ''
    or char_length(p_expected_title) > 200
  then
    raise exception using
      errcode = '22023',
      message = 'Parameter koreksi tidak valid.';
  end if;

  if p_confirmation is distinct from 'KOREKSI MEMORI' then
    raise exception using
      errcode = '22023',
      message = 'Konfirmasi koreksi tidak valid.';
  end if;

  if jsonb_typeof(v_changes) <> 'object' or v_changes = '{}'::jsonb then
    raise exception using
      errcode = '22023',
      message = 'Perubahan memori harus berupa object yang tidak kosong.';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(v_changes) as entry(key)
    where entry.key not in (
      'title',
      'memory_text',
      'period',
      'school_year',
      'event_year',
      'category',
      'people',
      'tags',
      'emotion',
      'clarity',
      'importance',
      'memory_type',
      'occurred_at',
      'details_patch'
    )
  ) then
    raise exception using
      errcode = '22023',
      message = 'Perubahan memori memuat field yang tidak diizinkan.';
  end if;

  if v_changes ? 'title' and (
    jsonb_typeof(v_changes -> 'title') <> 'string'
    or char_length(btrim(v_changes ->> 'title')) not between 1 and 200
  ) then
    raise exception using errcode = '22023', message = 'Judul tidak valid.';
  end if;

  if v_changes ? 'memory_text' and (
    jsonb_typeof(v_changes -> 'memory_text') <> 'string'
    or char_length(btrim(v_changes ->> 'memory_text')) not between 1 and 20000
  ) then
    raise exception using errcode = '22023', message = 'Isi memori tidak valid.';
  end if;

  if v_changes ? 'category' and (
    jsonb_typeof(v_changes -> 'category') <> 'string'
    or char_length(btrim(v_changes ->> 'category')) not between 1 and 120
  ) then
    raise exception using errcode = '22023', message = 'Kategori tidak valid.';
  end if;

  if v_changes ? 'clarity' and (
    jsonb_typeof(v_changes -> 'clarity') <> 'string'
    or char_length(btrim(v_changes ->> 'clarity')) not between 1 and 120
  ) then
    raise exception using errcode = '22023', message = 'Kejelasan tidak valid.';
  end if;

  if v_changes ? 'period' and not (
    jsonb_typeof(v_changes -> 'period') = 'null'
    or (
      jsonb_typeof(v_changes -> 'period') = 'string'
      and char_length(btrim(v_changes ->> 'period')) between 1 and 160
    )
  ) then
    raise exception using errcode = '22023', message = 'Periode tidak valid.';
  end if;

  if v_changes ? 'school_year' and not (
    jsonb_typeof(v_changes -> 'school_year') = 'null'
    or (
      jsonb_typeof(v_changes -> 'school_year') = 'string'
      and char_length(btrim(v_changes ->> 'school_year')) between 1 and 40
    )
  ) then
    raise exception using errcode = '22023', message = 'Tahun ajaran tidak valid.';
  end if;

  if v_changes ? 'emotion' and not (
    jsonb_typeof(v_changes -> 'emotion') = 'null'
    or (
      jsonb_typeof(v_changes -> 'emotion') = 'string'
      and char_length(btrim(v_changes ->> 'emotion')) between 1 and 120
    )
  ) then
    raise exception using errcode = '22023', message = 'Emosi tidak valid.';
  end if;

  if v_changes ? 'event_year' then
    if jsonb_typeof(v_changes -> 'event_year') = 'null' then
      v_event_year := null;
    elsif jsonb_typeof(v_changes -> 'event_year') = 'number' then
      if (v_changes ->> 'event_year') !~ '^[0-9]+$' then
        raise exception using errcode = '22023', message = 'Tahun kejadian tidak valid.';
      end if;
      begin
        v_event_year := (v_changes ->> 'event_year')::smallint;
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception using errcode = '22023', message = 'Tahun kejadian tidak valid.';
      end;
      if v_event_year not between 1 and 9999 then
        raise exception using errcode = '22023', message = 'Tahun kejadian tidak valid.';
      end if;
    else
      raise exception using errcode = '22023', message = 'Tahun kejadian tidak valid.';
    end if;
  end if;

  if v_changes ? 'importance' then
    if jsonb_typeof(v_changes -> 'importance') <> 'number'
      or (v_changes ->> 'importance') !~ '^[0-9]+$'
    then
      raise exception using errcode = '22023', message = 'Importance tidak valid.';
    end if;
    begin
      v_importance := (v_changes ->> 'importance')::smallint;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'Importance tidak valid.';
    end;
    if v_importance not between 1 and 5 then
      raise exception using errcode = '22023', message = 'Importance tidak valid.';
    end if;
  end if;

  if v_changes ? 'people' and (
    jsonb_typeof(v_changes -> 'people') <> 'array'
    or jsonb_array_length(v_changes -> 'people') > 50
    or exists (
      select 1
      from jsonb_array_elements(v_changes -> 'people') as person(value)
      where jsonb_typeof(person.value) <> 'string'
        or char_length(btrim(person.value #>> '{}')) not between 1 and 120
    )
  ) then
    raise exception using errcode = '22023', message = 'Daftar orang tidak valid.';
  end if;

  if v_changes ? 'tags' and (
    jsonb_typeof(v_changes -> 'tags') <> 'array'
    or jsonb_array_length(v_changes -> 'tags') > 50
    or exists (
      select 1
      from jsonb_array_elements(v_changes -> 'tags') as tag(value)
      where jsonb_typeof(tag.value) <> 'string'
        or char_length(btrim(tag.value #>> '{}')) not between 1 and 120
    )
  ) then
    raise exception using errcode = '22023', message = 'Tags tidak valid.';
  end if;

  if v_changes ? 'details_patch' then
    if jsonb_typeof(v_changes -> 'details_patch') <> 'object'
      or (v_changes -> 'details_patch') = '{}'::jsonb
    then
      raise exception using errcode = '22023', message = 'Details patch tidak valid.';
    end if;
    v_details_patch := v_changes -> 'details_patch';
    if v_details_patch ?| array[
      'memory_type',
      'expected_at',
      'occurred_at',
      'idempotency_key',
      'request_hash',
      'canonization',
      'correction',
      'corrections',
      'correction_history',
      'corrected_at',
      'last_correction'
    ] then
      raise exception using
        errcode = '22023',
        message = 'Details patch memakai nama metadata internal.';
    end if;
    if char_length(v_details_patch::text) > 10000 then
      raise exception using errcode = '22023', message = 'Details patch terlalu besar.';
    end if;
  end if;

  if v_changes ? 'memory_type'
    and jsonb_typeof(v_changes -> 'memory_type') <> 'string'
  then
    raise exception using errcode = '22023', message = 'Jenis memori tidak valid.';
  end if;

  if v_changes ? 'occurred_at' and not (
    jsonb_typeof(v_changes -> 'occurred_at') in ('string', 'null')
  ) then
    raise exception using errcode = '22023', message = 'Waktu kejadian tidak valid.';
  end if;

  if v_changes ? 'occurred_at'
    and jsonb_typeof(v_changes -> 'occurred_at') = 'string'
  then
    if (v_changes ->> 'occurred_at') !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
    then
      raise exception using errcode = '22023', message = 'Waktu kejadian tidak valid.';
    end if;
    begin
      perform (v_changes ->> 'occurred_at')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode = '22023', message = 'Waktu kejadian tidak valid.';
    end;
  end if;

  select m.*
  into v_row
  from public.charmaine_memories as m
  where m.memory_key = p_memory_key
    and m.title = p_expected_title
    and m.owner_id = v_uid
    and m.canon_status in ('draft', 'canon')
  for update;

  if not found then
    return;
  end if;

  v_memory_type := coalesce(
    v_changes ->> 'memory_type',
    v_row.details ->> 'memory_type',
    'event'
  );
  if v_memory_type not in ('event', 'fact', 'state') then
    raise exception using errcode = '22023', message = 'Jenis memori tidak valid.';
  end if;

  v_details := (coalesce(v_row.details, '{}'::jsonb)
    - 'canonization'
    - 'expected_at') || v_details_patch;
  v_details := jsonb_set(
    v_details,
    '{memory_type}',
    to_jsonb(v_memory_type),
    true
  );

  if v_changes ? 'occurred_at' then
    v_details := jsonb_set(
      v_details,
      '{occurred_at}',
      v_changes -> 'occurred_at',
      true
    );
  end if;

  v_details := jsonb_set(
    v_details,
    '{corrected_at}',
    to_jsonb(clock_timestamp()),
    true
  );

  if char_length(v_details::text) > 20000 then
    raise exception using errcode = '22023', message = 'Details hasil koreksi terlalu besar.';
  end if;

  return query
  update public.charmaine_memories as m
  set
    title = case
      when v_changes ? 'title' then btrim(v_changes ->> 'title')
      else m.title
    end,
    memory_text = case
      when v_changes ? 'memory_text' then btrim(v_changes ->> 'memory_text')
      else m.memory_text
    end,
    period = case
      when v_changes ? 'period' then nullif(btrim(v_changes ->> 'period'), '')
      else m.period
    end,
    school_year = case
      when v_changes ? 'school_year' then nullif(btrim(v_changes ->> 'school_year'), '')
      else m.school_year
    end,
    event_year = case
      when v_changes ? 'event_year' then v_event_year
      else m.event_year
    end,
    category = case
      when v_changes ? 'category' then btrim(v_changes ->> 'category')
      else m.category
    end,
    people = case
      when v_changes ? 'people' then array(
        select btrim(person.value)
        from jsonb_array_elements_text(v_changes -> 'people') as person(value)
      )
      else m.people
    end,
    tags = case
      when v_changes ? 'tags' then array(
        select btrim(tag.value)
        from jsonb_array_elements_text(v_changes -> 'tags') as tag(value)
      )
      else m.tags
    end,
    emotion = case
      when v_changes ? 'emotion' then nullif(btrim(v_changes ->> 'emotion'), '')
      else m.emotion
    end,
    clarity = case
      when v_changes ? 'clarity' then btrim(v_changes ->> 'clarity')
      else m.clarity
    end,
    importance = case
      when v_changes ? 'importance' then v_importance
      else m.importance
    end,
    details = v_details,
    canon_status = 'draft'
  where m.id = v_row.id
    and m.owner_id = v_uid
  returning m.memory_key, m.title, m.canon_status;
end;
$function$;

create or replace function public.delete_charmaine_memory(
  p_memory_key text,
  p_expected_title text,
  p_confirmation text
)
returns table (
  memory_key text,
  title text,
  canon_status text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_client_id text := nullif(auth.jwt() ->> 'client_id', '');
begin
  if v_uid is null or v_client_id is null then
    raise exception using errcode = '42501', message = 'Akses ditolak.';
  end if;

  if p_memory_key is null or btrim(p_memory_key) = ''
    or char_length(p_memory_key) > 160
    or p_expected_title is null or btrim(p_expected_title) = ''
    or char_length(p_expected_title) > 200
  then
    raise exception using
      errcode = '22023',
      message = 'Parameter penghapusan tidak valid.';
  end if;

  if p_confirmation is distinct from 'HAPUS PERMANEN' then
    raise exception using
      errcode = '22023',
      message = 'Konfirmasi penghapusan tidak valid.';
  end if;

  return query
  delete from public.charmaine_memories as m
  where m.memory_key = p_memory_key
    and m.title = p_expected_title
    and m.owner_id = v_uid
  returning m.memory_key, m.title, m.canon_status;
end;
$function$;

revoke all on function public.correct_charmaine_memory(text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.correct_charmaine_memory(text, text, text, jsonb)
  to authenticated;

revoke all on function public.delete_charmaine_memory(text, text, text)
  from public, anon, authenticated;
grant execute on function public.delete_charmaine_memory(text, text, text)
  to authenticated;
