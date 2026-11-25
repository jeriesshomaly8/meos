-- ---------------------------------------------------------------------------
-- 0017 — capture from anywhere (§v2.1 item 1: "Hey Siri, tell MeOS…").
--
-- A per-user capture URL on the calendar-feed pattern: the long random token
-- IS the credential, minted in the database, rotatable, revocable. What it
-- buys: an iOS Shortcut (or anything that can POST) can drop dictated text
-- into the *inbox* — never into memory. The text waits as a pending inbox
-- entry until the user reviews it through the ordinary analyze → confirm →
-- save flow, ambiguity gate included. Capture is not saving; the gate stays.
--
-- Why this is not §6.4's rejected inbound email: an email address is
-- guessable and receives from anyone, so every message needed SPF/DKIM
-- before a word could be trusted. This token is 128 bits of CSPRNG output
-- possessed only by the user's own Shortcut — the same trust model the
-- calendar feed has carried since 0009.
--
-- Additive: one column, one table, four functions. Rollback: drop them.
-- ---------------------------------------------------------------------------

-- Where a capture came from, so the app can show "waiting from Siri" without
-- guessing off timestamps. Existing rows are the app's own.
alter table public.inbox_entries
  add column source text not null default 'app'
  check (source in ('app', 'shortcut'));

create index inbox_entries_pending_shortcut_idx
  on public.inbox_entries (user_id, created_at)
  where processing_status = 'pending' and source = 'shortcut';

-- ---------------------------------------------------------------------------
-- capture_tokens — at most one live capture URL per user.
-- ---------------------------------------------------------------------------
create table public.capture_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  token text not null unique check (token ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Shown in settings, so "is the shortcut actually reaching MeOS?" has an
  -- answer other than a shrug.
  last_used_at timestamptz
);

create trigger capture_tokens_updated_at
  before update on public.capture_tokens
  for each row execute function public.set_updated_at();

alter table public.capture_tokens enable row level security;

create policy "capture_tokens_select_own" on public.capture_tokens
  for select using ((select auth.uid()) = user_id);
create policy "capture_tokens_insert_own" on public.capture_tokens
  for insert with check ((select auth.uid()) = user_id);
create policy "capture_tokens_update_own" on public.capture_tokens
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "capture_tokens_delete_own" on public.capture_tokens
  for delete using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.capture_tokens to authenticated;

create or replace function public.ensure_capture_token()
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

  insert into public.capture_tokens (user_id, token)
  values (v_user, public.new_calendar_token())
  on conflict (user_id) do nothing;

  select token into v_token from public.capture_tokens where user_id = v_user;
  return v_token;
end;
$$;

create or replace function public.rotate_capture_token()
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

  insert into public.capture_tokens (user_id, token)
  values (v_user, v_token)
  on conflict (user_id) do update set token = excluded.token;
  return v_token;
end;
$$;

create or replace function public.revoke_capture_token()
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from public.capture_tokens where user_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- capture_by_token(token, text) — the unauthenticated write, fenced.
-- ---------------------------------------------------------------------------
--
-- security definer because the caller is nobody: the Shortcut has a token,
-- not a session. The privilege is confined to one insert into the caller's
-- own inbox — the token resolves the user, the entry always lands 'pending',
-- and nothing here can touch memory proper. A wrong token and a revoked
-- token return the same false, for the same reason the feed 404s both alike.
create or replace function public.capture_by_token(p_token text, p_text text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_text text := nullif(trim(coalesce(p_text, '')), '');
begin
  if v_text is null or length(v_text) > 4000 then
    return false;
  end if;

  select user_id into v_user from public.capture_tokens where token = p_token;
  if v_user is null then
    return false;
  end if;

  insert into public.inbox_entries (user_id, original_text, processing_status, source)
  values (v_user, v_text, 'pending', 'shortcut');

  update public.capture_tokens set last_used_at = now() where user_id = v_user;
  return true;
end;
$$;

revoke all on function public.capture_by_token(text, text) from public;
grant execute on function public.capture_by_token(text, text) to anon, authenticated;
