-- Enforce the semantic and temporal contract used by new Charmaine memories.
-- Existing rows without any v2 semantic keys stay readable and correctable,
-- but only complete semantic memories can be inserted or promoted to canon.

begin;

create or replace function public.charmaine_memory_semantics_valid(
  p_details jsonb,
  p_event_year smallint,
  p_period text,
  p_school_year text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_precision text;
  v_occurred_at_text text;
  v_occurred_on_text text;
  v_temporal_note text;
  v_occurred_on date;
begin
  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    return false;
  end if;

  if jsonb_typeof(p_details -> 'factual_core') is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(p_details -> 'factual_core') not between 1 and 20
    or exists (
      select 1
      from jsonb_array_elements(p_details -> 'factual_core') as fact(value)
      where jsonb_typeof(fact.value) <> 'string'
        or char_length(btrim(fact.value #>> '{}')) not between 1 and 500
        or fact.value #>> '{}' <> btrim(fact.value #>> '{}')
    )
  then
    return false;
  end if;

  if jsonb_typeof(p_details -> 'continuity_mode') is distinct from 'string'
    or p_details ->> 'continuity_mode' not in (
      'shared_experience',
      'told_by_pit',
      'reconstructed_companion',
      'original_fiction'
    )
  then
    return false;
  end if;

  if jsonb_typeof(p_details -> 'temporal_precision') is distinct from 'string'
    or p_details ->> 'temporal_precision'
      not in ('instant', 'day', 'year', 'period', 'unknown')
  then
    return false;
  end if;
  v_precision := p_details ->> 'temporal_precision';

  if jsonb_typeof(p_details -> 'uncertain_fields') is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(p_details -> 'uncertain_fields') > 50
    or exists (
      select 1
      from jsonb_array_elements(p_details -> 'uncertain_fields') as field(value)
      where jsonb_typeof(field.value) <> 'string'
        or char_length(btrim(field.value #>> '{}')) not between 1 and 120
        or field.value #>> '{}' <> btrim(field.value #>> '{}')
    )
  then
    return false;
  end if;

  if p_details ? 'temporal_note'
    and jsonb_typeof(p_details -> 'temporal_note') not in ('string', 'null')
  then
    return false;
  end if;
  if jsonb_typeof(p_details -> 'temporal_note') = 'string' then
    v_temporal_note := p_details ->> 'temporal_note';
    if v_temporal_note <> btrim(v_temporal_note)
      or char_length(v_temporal_note) not between 1 and 500
    then
      return false;
    end if;
  end if;

  if p_details ? 'occurred_at'
    and jsonb_typeof(p_details -> 'occurred_at') not in ('string', 'null')
  then
    return false;
  end if;
  v_occurred_at_text := p_details ->> 'occurred_at';
  if v_occurred_at_text is not null then
    if v_occurred_at_text !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$'
    then
      return false;
    end if;
    begin
      perform v_occurred_at_text::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      return false;
    end;
  end if;

  if p_details ? 'occurred_on'
    and jsonb_typeof(p_details -> 'occurred_on') not in ('string', 'null')
  then
    return false;
  end if;
  v_occurred_on_text := p_details ->> 'occurred_on';
  if v_occurred_on_text is not null then
    if v_occurred_on_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      return false;
    end if;
    begin
      v_occurred_on := v_occurred_on_text::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      return false;
    end;
    if to_char(v_occurred_on, 'YYYY-MM-DD') <> v_occurred_on_text then
      return false;
    end if;
  end if;

  if p_event_year is not null and (
    p_event_year not between 1 and 9999
    or (
      v_occurred_at_text is not null
      and substring(v_occurred_at_text from 1 for 4)::smallint <> p_event_year
    )
    or (
      v_occurred_on_text is not null
      and substring(v_occurred_on_text from 1 for 4)::smallint <> p_event_year
    )
  ) then
    return false;
  end if;

  if p_period is not null and (
    p_period <> btrim(p_period)
    or char_length(p_period) not between 1 and 160
  ) then
    return false;
  end if;

  if p_school_year is not null and (
    p_school_year <> btrim(p_school_year)
    or char_length(p_school_year) not between 1 and 40
  ) then
    return false;
  end if;

  if v_precision = 'instant' then
    return v_occurred_at_text is not null and v_occurred_on_text is null;
  elsif v_precision = 'day' then
    return v_occurred_on_text is not null and v_occurred_at_text is null;
  elsif v_precision = 'year' then
    return p_event_year is not null
      and v_occurred_at_text is null
      and v_occurred_on_text is null;
  elsif v_precision = 'period' then
    return v_occurred_at_text is null
      and v_occurred_on_text is null
      and (
        nullif(btrim(coalesce(p_period, '')), '') is not null
        or nullif(btrim(coalesce(p_school_year, '')), '') is not null
        or v_temporal_note is not null
      );
  end if;

  return v_precision = 'unknown'
    and v_occurred_at_text is null
    and v_occurred_on_text is null
    and p_event_year is null
    and nullif(btrim(coalesce(p_period, '')), '') is null
    and nullif(btrim(coalesce(p_school_year, '')), '') is null;
end;
$function$;

revoke all on function public.charmaine_memory_semantics_valid(
  jsonb, smallint, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.charmaine_memory_semantics_valid(
  jsonb, smallint, text, text
) to authenticated, service_role;

create or replace function public.promote_charmaine_memory(
  p_memory_key text,
  p_expected_title text,
  p_confirmation text,
  p_note text default null
)
returns table (
  memory_key text,
  title text,
  canon_status text,
  promoted boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_client_id text := nullif(auth.jwt() ->> 'client_id', '');
  v_row public.charmaine_memories%rowtype;
  v_canonization jsonb;
  v_details jsonb;
begin
  if v_uid is null or v_client_id is null then
    raise exception using errcode = '42501', message = 'Akses ditolak.';
  end if;

  if p_memory_key is null
    or btrim(p_memory_key) = ''
    or p_memory_key <> btrim(p_memory_key)
    or char_length(p_memory_key) > 160
    or p_expected_title is null
    or btrim(p_expected_title) = ''
    or p_expected_title <> btrim(p_expected_title)
    or char_length(p_expected_title) > 200
    or p_confirmation is distinct from 'JADIKAN CANON'
    or (
      p_note is not null
      and (
        p_note <> btrim(p_note)
        or char_length(p_note) not between 1 and 1000
      )
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Parameter promosi tidak valid.';
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

  if v_row.canon_status = 'canon' then
    return query
    select v_row.memory_key, v_row.title, v_row.canon_status, false;
    return;
  end if;

  if coalesce(v_row.details ->> 'memory_type', 'event')
      not in ('event', 'fact', 'state')
    or v_row.details ->> 'expected_at' is not null
    or public.charmaine_memory_semantics_valid(
      v_row.details,
      v_row.event_year,
      v_row.period,
      v_row.school_year
    ) is not true
  then
    return;
  end if;

  v_canonization := case
    when jsonb_typeof(v_row.details -> 'canonization') = 'object'
      then v_row.details -> 'canonization'
    else '{}'::jsonb
  end;
  v_canonization := jsonb_set(
    v_canonization - 'occurred_at',
    '{canonized_at}',
    to_jsonb(clock_timestamp()),
    true
  );
  if p_note is not null then
    v_canonization := jsonb_set(
      v_canonization,
      '{note}',
      to_jsonb(p_note),
      true
    );
  end if;
  v_details := jsonb_set(
    v_row.details,
    '{canonization}',
    v_canonization,
    true
  );

  return query
  update public.charmaine_memories as m
  set
    canon_status = 'canon',
    details = v_details
  where m.id = v_row.id
    and m.owner_id = v_uid
    and m.canon_status = 'draft'
  returning m.memory_key, m.title, m.canon_status, true;
end;
$function$;

revoke all on function public.promote_charmaine_memory(text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.promote_charmaine_memory(text, text, text, text)
  to authenticated;

alter table public.charmaine_memories
  drop constraint if exists charmaine_memories_semantics_check;
alter table public.charmaine_memories
  add constraint charmaine_memories_semantics_check
  check (
    not (details ?| array[
      'factual_core',
      'continuity_mode',
      'temporal_precision',
      'uncertain_fields',
      'occurred_on',
      'temporal_note'
    ])
    or coalesce(
      public.charmaine_memory_semantics_valid(
        details,
        event_year,
        period,
        school_year
      ),
      false
    )
  ) not valid;
alter table public.charmaine_memories
  validate constraint charmaine_memories_semantics_check;

drop policy if exists charmaine_owner_insert on public.charmaine_memories;
create policy charmaine_owner_insert
  on public.charmaine_memories
  for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and nullif((select auth.jwt() ->> 'client_id'), '') is not null
    and canon_status = 'draft'
    and perspective = 'charmaine'
    and coalesce(details ->> 'memory_type', 'event')
      in ('event', 'fact', 'state')
    and details ->> 'expected_at' is null
    and public.charmaine_memory_semantics_valid(
      details,
      event_year,
      period,
      school_year
    )
  );

drop policy if exists charmaine_owner_update on public.charmaine_memories;
revoke update on public.charmaine_memories from authenticated;
revoke update (canon_status, details)
  on public.charmaine_memories from authenticated;

commit;

-- Verification after applying:
--   * legacy rows without semantic keys remain readable and correctable;
--   * new inserts and atomic draft -> canon promotions require complete data;
--   * authenticated has no direct table UPDATE privilege;
--   * day-only memories use occurred_on and never invent a clock time;
--   * contradictory timestamps, dates, years, and precision are rejected;
--   * new writes are always from the Charmaine perspective.
