-- §6.3 C — Web Push, so an alarm rings with MeOS closed.
--
-- The honest framing from §9.1: this is a nag that escalates, not an alarm
-- clock. A push plays the *system notification sound*, once, and every
-- platform silences notifications under Do Not Disturb and Focus. What it
-- buys over the foreground ring is that the phone does not need MeOS open,
-- and what it buys over the OS hand-off (§6.3 A/B) is that the user does not
-- have to do anything. It is the fallback, and the UI says so.
--
-- Why a table and not a column on profiles: one user has several browsers, and
-- each install is its own subscription with its own keys. A phone that
-- reinstalls the PWA produces a new endpoint and orphans the old one, so rows
-- are disposable by design and deleted on the first 404/410 from the push
-- service.
--
-- Rollback: drop the table and the two functions. Nothing else depends on them.

-- ---------------------------------------------------------------------------
-- push_subscriptions — one row per browser install.
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The push service's URL for this install. Unique across the table, not just
  -- per user: the same endpoint can never legitimately belong to two accounts,
  -- and a stale row from a previous sign-in would otherwise send someone
  -- else's alarms to this device.
  endpoint text not null unique,
  -- The two halves of the client's key pair, base64url, exactly as the browser
  -- reported them. Stored verbatim because the encryption is done by the
  -- sender at push time and any normalisation here would silently break it.
  p256dh text not null,
  auth text not null,
  -- Purely diagnostic: "which of my devices is this?" in settings.
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set when the push service last accepted a message. A row that has never
  -- succeeded is the signature of a subscription that was never really live.
  last_success_at timestamptz,
  -- Consecutive failures. Rows are dropped on a hard 404/410 rather than
  -- counted, so this only climbs on soft errors worth noticing.
  failure_count integer not null default 0
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create trigger push_subscriptions_updated_at
  before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions_select_own" on public.push_subscriptions
  for select using (auth.uid() = user_id);
create policy "push_subscriptions_insert_own" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);
create policy "push_subscriptions_update_own" on public.push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "push_subscriptions_delete_own" on public.push_subscriptions
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- ---------------------------------------------------------------------------
-- alarm_deliveries — what has already been pushed, so a retry is not a repeat.
-- ---------------------------------------------------------------------------
--
-- Escalation means re-pushing the same alarm every ~20s until it is dismissed,
-- and the sender may run more than once for the same window. Idempotency is
-- per (alarm, minute, attempt, endpoint): the primary key is what stops a
-- cron overlap turning one alarm into two notifications at the same instant.
-- The endpoint is part of the key because delivery is per *device* — a user
-- with a phone and a laptop must get the chime on both, not on whichever one
-- happened to claim first.
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

-- ---------------------------------------------------------------------------
-- due_alarm_pushes(window_seconds) — what the sender should deliver right now.
-- ---------------------------------------------------------------------------
--
-- security definer because the sender authenticates as nobody: it is a cron
-- job, not a session. The privilege is confined to this one read, it takes no
-- user id, and it can only ever return rows for alarms that are active and
-- currently due — so a caller cannot ask it for someone's whole calendar.
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
      -- Already due, and not so long ago that ringing would ambush someone.
      -- Mirrors RING_GRACE_MS on the client, in the one place that decides.
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

revoke all on function public.due_alarm_pushes(integer) from public, anon, authenticated;
-- The sender authenticates to PostgREST as service_role, which is not the
-- function owner — without this grant its RPC is denied outright.
grant execute on function public.due_alarm_pushes(integer) to service_role;

-- ---------------------------------------------------------------------------
-- record_alarm_push(...) — claim one attempt before sending it.
-- ---------------------------------------------------------------------------
--
-- Returns whether *this* caller inserted the row. The sender claims first and
-- pushes second, so two overlapping cron ticks cannot both deliver the same
-- attempt — the loser of the race skips it. A claim whose send then fails
-- costs one chime out of a fifteen-chime escalation, which is the cheaper
-- side of that trade.
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
