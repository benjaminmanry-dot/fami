-- Private single-owner ledger. No anonymous or authenticated browser role can
-- read or replace it. All operations pass through the MFA-enforcing function.
create schema if not exists owner_private;
revoke all on schema owner_private from public, anon, authenticated;
create table owner_private.ledger (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 0 check (revision >= 0),
  body jsonb not null check (body->>'schema' = '1'),
  updated_at timestamptz not null default now()
);
create table owner_private.effect_fences (
  operation_id text not null,
  phase text not null,
  digest text not null,
  started_at timestamptz not null default now(),
  primary key (operation_id, phase)
);
alter table owner_private.ledger enable row level security;
alter table owner_private.effect_fences enable row level security;
revoke all on all tables in schema owner_private from public, anon, authenticated;

create function public.owner_panel_load() returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('revision', revision, 'body', body)
  from owner_private.ledger where singleton;
$$;

create function public.owner_panel_cas(expected_revision bigint, next_body jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare current_body jsonb; current_revision bigint; old_row jsonb; new_row jsonb;
begin
  -- One compare-and-swap serializes closeouts, receipt allocation, cancellation,
  -- worker claims and enrollment without a process-local or browser mutex.
  perform pg_advisory_xact_lock(20420601);
  select body, revision into current_body, current_revision from owner_private.ledger where singleton for update;
  if not found then
    if expected_revision <> -1 then return false; end if;
    insert into owner_private.ledger(singleton, revision, body) values (true, 0, next_body);
    return true;
  end if;
  if current_revision <> expected_revision then return false; end if;
  if next_body->>'schema' <> '1' or pg_column_size(next_body) > 16000000 then raise exception 'Invalid ledger'; end if;
  -- Once approved, charges and prior audit entries are immutable even if a
  -- future server bug attempts to replace the complete snapshot.
  for old_row in select value from jsonb_array_elements(current_body->'obligations') loop
    select value into new_row from jsonb_array_elements(next_body->'obligations') where value->>'id' = old_row->>'id';
    if new_row is distinct from old_row then raise exception 'Historical obligation changed'; end if;
  end loop;
  for old_row in select value from jsonb_array_elements(current_body->'audit') loop
    select value into new_row from jsonb_array_elements(next_body->'audit') where value->>'id' = old_row->>'id';
    if new_row is distinct from old_row then raise exception 'Audit history changed'; end if;
  end loop;
  for old_row in select value from jsonb_array_elements(current_body->'operations') loop
    select value into new_row from jsonb_array_elements(next_body->'operations') where value->>'id' = old_row->>'id';
    if new_row is null or new_row->'items' is distinct from old_row->'items'
      or new_row->'amountCents' is distinct from old_row->'amountCents'
      or new_row->'approvedAt' is distinct from old_row->'approvedAt'
      or new_row->'authorization' is distinct from old_row->'authorization'
      or new_row->'paymentMethodId' is distinct from old_row->'paymentMethodId'
      or new_row->'customerId' is distinct from old_row->'customerId'
      then raise exception 'Collection identity changed'; end if;
  end loop;
  for old_row in select value from jsonb_array_elements(current_body->'allocations') loop
    select value into new_row from jsonb_array_elements(next_body->'allocations') where value->>'id' = old_row->>'id';
    if new_row is distinct from old_row then raise exception 'Payment allocation history changed'; end if;
  end loop;
  for old_row in select value from jsonb_array_elements(current_body->'receipts') loop
    select value into new_row from jsonb_array_elements(next_body->'receipts') where value->>'id' = old_row->>'id';
    if new_row is null or new_row->'providerId' is distinct from old_row->'providerId'
      or new_row->'provider' is distinct from old_row->'provider'
      or new_row->'amountCents' is distinct from old_row->'amountCents'
      or new_row->'currency' is distinct from old_row->'currency'
      or new_row->'direction' is distinct from old_row->'direction'
      or new_row->'receivedAt' is distinct from old_row->'receivedAt'
      then raise exception 'Original receipt changed'; end if;
  end loop;
  update owner_private.ledger set body = next_body, revision = revision + 1, updated_at = now() where singleton;
  return true;
end;
$$;

create function public.owner_panel_effect_once(op_id text, effect_phase text, effect_digest text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare inserted integer;
begin
  insert into owner_private.effect_fences(operation_id, phase, digest)
    values (op_id, effect_phase, effect_digest) on conflict do nothing;
  get diagnostics inserted = row_count;
  return inserted = 1;
end;
$$;

revoke all on function public.owner_panel_load() from public, anon, authenticated;
revoke all on function public.owner_panel_cas(bigint, jsonb) from public, anon, authenticated;
revoke all on function public.owner_panel_effect_once(text, text, text) from public, anon, authenticated;
grant usage on schema owner_private to service_role;
grant execute on function public.owner_panel_load() to service_role;
grant execute on function public.owner_panel_cas(bigint, jsonb) to service_role;
grant execute on function public.owner_panel_effect_once(text, text, text) to service_role;

create function public.owner_panel_backup() returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('format', '20fates-backup/1', 'createdAt', now(),
    'ledger', (select jsonb_build_object('revision', revision, 'body', body) from owner_private.ledger where singleton),
    'fences', coalesce((select jsonb_agg(to_jsonb(f)) from owner_private.effect_fences f), '[]'::jsonb));
$$;
revoke all on function public.owner_panel_backup() from public, anon, authenticated;
grant execute on function public.owner_panel_backup() to service_role;

-- Cron can check for due work without downloading the private ledger each minute.
create function public.owner_panel_due() returns boolean
language sql security definer set search_path = '' as $$
  select coalesce((select
    exists (select 1 from jsonb_array_elements(body->'operations') o where o->>'status' = 'queued'
      or (o->>'status' = 'processing' and (o->>'startedAt')::timestamptz < now() - interval '3 minutes'))
    or exists (select 1 from jsonb_each(body->'feeds') f where f.value->>'lastAttempt' is null
      or (f.value->>'lastAttempt')::timestamptz < now() - interval '15 minutes')
    from owner_private.ledger where singleton), true);
$$;
revoke all on function public.owner_panel_due() from public, anon, authenticated;
grant execute on function public.owner_panel_due() to service_role;
