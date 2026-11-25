-- §6.3 E — a per-user ICS feed at a revocable token URL.
--
-- The rule from §6.1: hand the job to the operating system. The phone already
-- has a calendar that syncs, notifies and renders better than anything MeOS
-- could build, so MeOS publishes into it rather than growing a calendar of its
-- own. One-way and read-only by construction.
--
-- Why a token and not a session: a calendar client cannot log in. It fetches a
-- URL, unauthenticated, forever. So the URL *is* the credential — 256 bits of
-- it — and it has to be revocable, because a leaked feed URL is a leaked
-- calendar and there is no other way to take it back.
--
-- Why a security-definer function and not the service-role key: the feed route
-- is public and unauthenticated. Handing it a key that bypasses RLS for every
-- row in the database would mean one forgotten `.eq("user_id", …)` leaks
-- somebody else's dates. Here the privilege lives in one function whose only
-- entry point is the token, and the user it resolves to is the only user whose
-- rows it can read.
--
-- Rollback: drop the four functions and the table. Nothing else depends on them.

-- ---------------------------------------------------------------------------
-- calendar_feeds — at most one live feed per user.
-- ---------------------------------------------------------------------------
create table public.calendar_feeds (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- 64 hex characters. Two v4 UUIDs' worth of CSPRNG output, formatted for a
  -- URL. gen_random_uuid() is core Postgres, so this does not depend on where
  -- pgcrypto happens to be installed.
  token text not null unique check (token ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Shown in settings so "is my calendar actually subscribed?" has an answer
  -- other than a shrug.
  last_fetched_at timestamptz
);

create trigger calendar_feeds_updated_at
  before update on public.calendar_feeds
  for each row execute function public.set_updated_at();

alter table public.calendar_feeds enable row level security;

create policy "calendar_feeds_select_own" on public.calendar_feeds
  for select using ((select auth.uid()) = user_id);
create policy "calendar_feeds_insert_own" on public.calendar_feeds
  for insert with check ((select auth.uid()) = user_id);
create policy "calendar_feeds_update_own" on public.calendar_feeds
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "calendar_feeds_delete_own" on public.calendar_feeds
  for delete using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.calendar_feeds to authenticated;

create or replace function public.new_calendar_token()
returns text language sql volatile as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;

-- ---------------------------------------------------------------------------
-- Turning the feed on, rotating it, turning it off.
--
-- Rotation and revocation are the same act from the user's side — "the old
-- link stops working" — so they are two functions over one row rather than a
-- status column that could disagree with the token.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_calendar_feed()
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_token text;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  insert into public.calendar_feeds (user_id, token)
  values (v_user, public.new_calendar_token())
  on conflict (user_id) do nothing;

  select token into v_token from public.calendar_feeds where user_id = v_user;
  return v_token;
end;
$$;

create or replace function public.rotate_calendar_feed()
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_token text := public.new_calendar_token();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  insert into public.calendar_feeds (user_id, token)
  values (v_user, v_token)
  on conflict (user_id) do update set token = excluded.token, last_fetched_at = null;

  select token into v_token from public.calendar_feeds where user_id = v_user;
  return v_token;
end;
$$;

create or replace function public.revoke_calendar_feed()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from public.calendar_feeds where user_id = v_user;
end;
$$;

grant execute on function public.ensure_calendar_feed() to authenticated;
grant execute on function public.rotate_calendar_feed() to authenticated;
grant execute on function public.revoke_calendar_feed() to authenticated;

-- ---------------------------------------------------------------------------
-- The feed itself.
--
-- Returns null for an unknown, malformed or revoked token, which the route
-- turns into a 404 — a revoked link must look exactly like a link that never
-- existed.
--
-- Dates come out in two shapes and the caller renders them differently:
--   * `date`  — an all-day event. Already resolved to the user's own zone here,
--               because an instant rendered as a day is only right in one zone
--               (§1.6), and the calendar client has no idea which one that is.
--   * `start` — an instant, rendered as UTC in the ICS.
-- ---------------------------------------------------------------------------
create or replace function public.calendar_feed_events(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_zone text;
  v_name text;
  v_events jsonb;
begin
  -- Shape-check before touching the table: cheap, and it keeps probing traffic
  -- off the index.
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select user_id into v_user from public.calendar_feeds where token = p_token;
  if v_user is null then
    return null;
  end if;

  update public.calendar_feeds set last_fetched_at = now() where user_id = v_user;

  select coalesce(nullif(trim(p.timezone), ''), 'UTC'), p.display_name
    into v_zone, v_name
  from public.profiles p
  where p.id = v_user;
  v_zone := coalesce(v_zone, 'UTC');

  with source as (
    -- Birthdays, anniversaries and everything else the user called a date.
    select
      'date-' || d.id::text as uid,
      d.title as title,
      d.notes as description,
      'important_date' as kind,
      d.event_date as on_date,
      null::timestamptz as at_instant,
      (d.recurrence = 'yearly') as yearly
    from public.important_dates d
    where d.user_id = v_user

    union all

    -- A birthday stored on the person rather than as a date of its own. The
    -- NOT EXISTS keeps it from appearing twice when the capture produced both.
    select
      'birthday-' || pe.id::text,
      'Birthday — ' || pe.name,
      null,
      'birthday',
      pe.birthday,
      null::timestamptz,
      true
    from public.people pe
    where pe.user_id = v_user
      and pe.birthday is not null
      and not exists (
        select 1 from public.important_dates d2
        where d2.user_id = v_user
          and d2.person_id = pe.id
          and extract(month from d2.event_date) = extract(month from pe.birthday)
          and extract(day from d2.event_date) = extract(day from pe.birthday)
      )

    union all

    select
      'doc-' || dc.id::text,
      dc.display_name || ' expires',
      dc.notes,
      'document',
      dc.expiration_date,
      null::timestamptz,
      false
    from public.documents dc
    where dc.user_id = v_user and dc.expiration_date is not null

    union all

    select
      'reminder-' || r.id::text,
      r.title,
      null,
      'reminder',
      null::date,
      r.remind_at,
      false
    from public.reminders r
    where r.user_id = v_user and r.completed = false

    union all

    -- The universal layer: tasks, alarms, events and dated lists. An all-day
    -- row becomes a day in the user's zone; everything else keeps its instant.
    select
      'item-' || i.id::text,
      i.title,
      i.summary,
      i.capability,
      case when i.all_day
        then (coalesce(i.starts_at, i.due_at) at time zone coalesce(nullif(i.timezone, ''), v_zone))::date
        else null::date
      end,
      case when i.all_day then null::timestamptz else coalesce(i.starts_at, i.due_at) end,
      false
    from public.items i
    where i.user_id = v_user
      and i.status = 'active'
      and i.capability in ('task', 'alarm', 'event', 'list')
      and coalesce(i.starts_at, i.due_at) is not null
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'uid', uid,
        'title', title,
        'description', description,
        'kind', kind,
        'date', on_date,
        'start', at_instant,
        'yearly', yearly
      )
      order by coalesce(at_instant, on_date::timestamptz) desc
    ),
    '[]'::jsonb
  )
  into v_events
  -- A guard, not a policy: a feed nobody can parse is worse than one that
  -- stops at the thousand most recent dates.
  from (select * from source order by coalesce(at_instant, on_date::timestamptz) desc limit 1000) capped;

  return jsonb_build_object(
    'calendarName', case
      when v_name is null or trim(v_name) = '' then 'MeOS'
      else 'MeOS — ' || v_name
    end,
    'timezone', v_zone,
    'events', v_events
  );
end;
$$;

-- Anonymous on purpose: the calendar client fetching this has no session, and
-- the token is what authorises it.
grant execute on function public.calendar_feed_events(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- "Delete all my data" must take the feed with it.
--
-- Same reasoning as migration 0006: leaving a live token behind would keep
-- serving a calendar for data the user just asked to have erased. Only the two
-- new lines differ from the 0006 version.
-- ---------------------------------------------------------------------------
create or replace function public.delete_all_my_data()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- The published calendar first: revoking the link before deleting the rows
  -- means there is no window where the feed serves half-deleted data.
  delete from public.calendar_feeds where user_id = v_user_id;

  -- v2 layer: item_relations and list_items cascade from items, but deleting
  -- explicitly keeps this readable and order-independent.
  delete from public.item_relations where user_id = v_user_id;
  delete from public.list_items where user_id = v_user_id;
  delete from public.items where user_id = v_user_id;
  delete from public.item_types where user_id = v_user_id;

  -- v1 tables.
  delete from public.entity_links where user_id = v_user_id;
  delete from public.reminders where user_id = v_user_id;
  delete from public.person_preferences where user_id = v_user_id;
  delete from public.food_preferences where user_id = v_user_id;
  delete from public.important_dates where user_id = v_user_id;
  delete from public.recipes where user_id = v_user_id; -- cascades to ingredients
  delete from public.documents where user_id = v_user_id;
  delete from public.notes where user_id = v_user_id;
  delete from public.people where user_id = v_user_id;
  delete from public.inbox_entries where user_id = v_user_id;
end;
$$;
