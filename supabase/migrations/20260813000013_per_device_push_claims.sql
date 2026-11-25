-- ---------------------------------------------------------------------------
-- 0013 — push delivery claims become per *device*.
--
-- 0011's first published form keyed alarm_deliveries on (item, minute,
-- attempt), so a user with a phone and a laptop got each escalation chime on
-- whichever device claimed first — one arbitrary device, not both. The key
-- gains the endpoint, and both sender functions follow.
--
-- This exists as a follow-up because the hosted database recorded 0011 before
-- the defect was caught; 0011 in this repo already carries the fixed
-- definitions, so on a fresh database this migration recreates identical
-- objects. alarm_deliveries holds only delivery bookkeeping (rows expire from
-- relevance in minutes), so drop-and-recreate loses nothing worth keeping.
--
-- Rollback: reapply 0011's definitions.
-- ---------------------------------------------------------------------------

drop function if exists public.record_alarm_push(uuid, uuid, timestamptz, smallint);
drop function if exists public.record_alarm_push(uuid, uuid, timestamptz, smallint, text);
drop function if exists public.due_alarm_pushes(integer);
drop table if exists public.alarm_deliveries;

create table public.alarm_deliveries (
  item_id uuid not null references public.items (id) on delete cascade,
  -- Truncated to the minute. An alarm rings at a time, not at a millisecond.
  minute timestamptz not null,
  attempt smallint not null,
  endpoint text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (item_id, minute, attempt, endpoint)
);

create index alarm_deliveries_sent_idx on public.alarm_deliveries (sent_at);

alter table public.alarm_deliveries enable row level security;

-- Read-only to the owner: rows are written by the sender, which runs with
-- elevated rights, and nothing in the app should be able to forge a delivery
-- record and suppress its own alarm.
create policy "alarm_deliveries_select_own" on public.alarm_deliveries
  for select using (auth.uid() = user_id);

grant select on public.alarm_deliveries to authenticated;

create or replace function public.due_alarm_pushes(window_seconds integer default 300)
returns table (
  item_id uuid,
  user_id uuid,
  title text,
  due_at timestamptz,
  attempt smallint,
  endpoint text,
  p256dh text,
  auth text
)
language sql
security definer
set search_path = public
as $$
  with due as (
    select
      i.id,
      i.user_id,
      i.title,
      i.due_at,
      -- Which push this is in the escalation. One chime is missable; a
      -- sequence is an alarm. 20s apart, so attempt 15 is five minutes in.
      (floor(extract(epoch from (now() - i.due_at)) / 20))::smallint as attempt
    from public.items i
    where i.capability = 'alarm'
      and i.status = 'active'
      and i.due_at is not null
      and i.due_at <= now()
      and i.due_at > now() - make_interval(secs => window_seconds)
  )
  select d.id, d.user_id, d.title, d.due_at, d.attempt, s.endpoint, s.p256dh, s.auth
  from due d
  join public.push_subscriptions s on s.user_id = d.user_id
  where not exists (
    select 1 from public.alarm_deliveries a
    where a.item_id = d.id
      and a.minute = date_trunc('minute', d.due_at)
      and a.attempt = d.attempt
      and a.endpoint = s.endpoint
  );
$$;

-- The sender authenticates to PostgREST as service_role, which is not the
-- function owner — without these grants its RPC is denied outright.
revoke all on function public.due_alarm_pushes(integer) from public, anon, authenticated;
grant execute on function public.due_alarm_pushes(integer) to service_role;

create or replace function public.record_alarm_push(
  p_item_id uuid,
  p_user_id uuid,
  p_due_at timestamptz,
  p_attempt smallint,
  p_endpoint text
)
returns boolean
language sql
security definer
set search_path = public
as $$
  with claimed as (
    insert into public.alarm_deliveries (item_id, minute, attempt, endpoint, user_id)
    values (p_item_id, date_trunc('minute', p_due_at), p_attempt, p_endpoint, p_user_id)
    on conflict (item_id, minute, attempt, endpoint) do nothing
    returning 1
  )
  select exists (select 1 from claimed);
$$;

revoke all on function public.record_alarm_push(uuid, uuid, timestamptz, smallint, text) from public, anon, authenticated;
grant execute on function public.record_alarm_push(uuid, uuid, timestamptz, smallint, text) to service_role;
