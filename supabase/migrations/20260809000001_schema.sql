-- MeOS initial schema.
-- Conventions:
--   * Every user-owned table has user_id -> auth.users(id) ON DELETE CASCADE,
--     so the Supabase "delete user" admin call removes all of their data.
--   * Dates whose year the user never stated are stored with sentinel year 2000
--     and the matching *_year_known flag set to false. The UI must never show
--     the sentinel year.
--   * created_at/updated_at are timestamptz; updated_at maintained by trigger.

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- profiles ------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row whenever a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- people --------------------------------------------------------------------
create table public.people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  relationship text,
  birthday date,
  birthday_year_known boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index people_user_id_idx on public.people (user_id);
create index people_user_name_idx on public.people (user_id, lower(name));

create trigger people_updated_at
  before update on public.people
  for each row execute function public.set_updated_at();

-- person_preferences (general, non-food preferences) ------------------------
create table public.person_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  preference_type text not null check (preference_type in ('like', 'dislike')),
  value text not null,
  notes text,
  created_at timestamptz not null default now()
);

create index person_preferences_user_id_idx on public.person_preferences (user_id);
create index person_preferences_person_id_idx on public.person_preferences (person_id);

-- important_dates ------------------------------------------------------------
create table public.important_dates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  event_date date not null,
  year_known boolean not null default true,
  recurrence text not null default 'none' check (recurrence in ('none', 'yearly')),
  person_id uuid references public.people (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index important_dates_user_id_idx on public.important_dates (user_id);
create index important_dates_person_id_idx on public.important_dates (person_id);
create index important_dates_event_date_idx on public.important_dates (user_id, event_date);

create trigger important_dates_updated_at
  before update on public.important_dates
  for each row execute function public.set_updated_at();

-- reminders ------------------------------------------------------------------
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  remind_at timestamptz not null,
  completed boolean not null default false,
  related_entity_type text check (
    related_entity_type in ('person', 'important_date', 'document', 'recipe', 'note', 'food_preference')
  ),
  related_entity_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reminders_related_pair check (
    (related_entity_type is null) = (related_entity_id is null)
  )
);

create index reminders_user_id_idx on public.reminders (user_id);
create index reminders_remind_at_idx on public.reminders (user_id, remind_at) where not completed;

create trigger reminders_updated_at
  before update on public.reminders
  for each row execute function public.set_updated_at();

-- food_preferences -----------------------------------------------------------
-- person_id null = the user's own preference.
create table public.food_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  person_id uuid references public.people (id) on delete cascade,
  food_name text not null,
  preference_type text not null check (
    preference_type in ('like', 'dislike', 'allergy', 'dietary_restriction')
  ),
  severity text check (severity in ('mild', 'moderate', 'severe')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index food_preferences_user_id_idx on public.food_preferences (user_id);
create index food_preferences_person_id_idx on public.food_preferences (person_id);

create trigger food_preferences_updated_at
  before update on public.food_preferences
  for each row execute function public.set_updated_at();

-- recipes --------------------------------------------------------------------
create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  preparation_time_minutes integer check (preparation_time_minutes >= 0),
  cooking_time_minutes integer check (cooking_time_minutes >= 0),
  servings integer check (servings > 0),
  instructions text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recipes_user_id_idx on public.recipes (user_id);

create trigger recipes_updated_at
  before update on public.recipes
  for each row execute function public.set_updated_at();

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  ingredient_name text not null,
  quantity numeric check (quantity >= 0),
  unit text,
  optional boolean not null default false,
  notes text
);

create index recipe_ingredients_recipe_id_idx on public.recipe_ingredients (recipe_id);

-- documents ------------------------------------------------------------------
-- document_number is sensitive: masked by default in the UI and excluded from
-- AI prompts wherever possible. Real secrets (passwords) do NOT belong here —
-- that is what the future end-to-end-encrypted Secure Vault is for.
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document_type text not null,
  display_name text not null,
  document_number text,
  issue_date date,
  expiration_date date,
  issuing_country text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index documents_user_id_idx on public.documents (user_id);
create index documents_expiration_idx on public.documents (user_id, expiration_date);

create trigger documents_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

-- notes ----------------------------------------------------------------------
-- `pinned` is not in the original spec column list but the Notes UI requires
-- pinning; kept here so the feature is honest end to end.
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  content text not null,
  note_type text not null default 'general' check (
    note_type in ('idea', 'memory', 'general', 'place', 'gift_idea')
  ),
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notes_user_id_idx on public.notes (user_id);

create trigger notes_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

-- inbox_entries --------------------------------------------------------------
create table public.inbox_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  original_text text not null,
  processing_status text not null default 'pending' check (
    processing_status in ('pending', 'analyzed', 'confirmed', 'discarded', 'failed')
  ),
  extracted_json jsonb,
  created_at timestamptz not null default now()
);

create index inbox_entries_user_id_idx on public.inbox_entries (user_id, created_at desc);

-- entity_links ---------------------------------------------------------------
create table public.entity_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_entity_type text not null,
  source_entity_id uuid not null,
  target_entity_type text not null,
  target_entity_id uuid not null,
  relationship_type text not null,
  created_at timestamptz not null default now()
);

create index entity_links_user_id_idx on public.entity_links (user_id);
create index entity_links_source_idx on public.entity_links (source_entity_type, source_entity_id);
create index entity_links_target_idx on public.entity_links (target_entity_type, target_entity_id);
