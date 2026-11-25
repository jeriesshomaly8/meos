-- MeOS v2 foundation: a universal item layer beside the existing tables.
--
-- ADDITIVE ONLY. This migration creates new objects and touches nothing that
-- already exists, so every current row keeps rendering from its own screen and
-- `save_extracted_items()` keeps working unchanged during rollout.
--
-- Division of responsibility:
--   * The seven original tables stay authoritative for their categories.
--   * New capabilities (task, list, event) and every user/AI-proposed custom
--     type live in `items`. Nothing is stored in both places.
--   * `items.legacy_table/legacy_id` is the bridge when a universal item needs
--     to point at a row in one of the original tables.
--
-- Rollback: drop the four tables and three functions created here. No existing
-- object depends on them.

-- ---------------------------------------------------------------------------
-- Approved icon and colour sets.
--
-- A proposed type may only use these. The AI never issues DDL and never picks
-- a raw hex value; it picks a name from a list the design system already
-- supports, which is what keeps custom types visually consistent.
-- ---------------------------------------------------------------------------
create or replace function public.meos_allowed_icons()
returns text[] language sql immutable parallel safe as $$
  select array[
    'box','calendar','car','check','clipboard','coins','cup-soda','dumbbell',
    'file-text','gift','globe','graduation-cap','hammer','heart','home','key',
    'landmark','laptop','leaf','lightbulb','list','map-pin','music','package',
    'paw-print','pill','plane','receipt','repeat','shield','shopping-cart',
    'sparkles','stethoscope','ticket','tv','user','users','wallet','wrench'
  ]
$$;

create or replace function public.meos_allowed_colors()
returns text[] language sql immutable parallel safe as $$
  select array[
    'person','date','reminder','food','recipe','document','note',
    'accent','neutral','success','warning'
  ]
$$;

-- ---------------------------------------------------------------------------
-- Attribute guard.
--
-- `items.attributes` is raw model output and must be treated as hostile.
-- Allowed shape is deliberately shallow: an object whose values are scalars or
-- flat arrays of scalars. No nested objects, so maximum depth is 2 and the
-- structure stays indexable and renderable by generic field metadata.
-- ---------------------------------------------------------------------------
create or replace function public.meos_attributes_ok(a jsonb)
returns boolean
language plpgsql
immutable
parallel safe
as $$
declare
  k text;
  v jsonb;
  e jsonb;
begin
  if a is null or jsonb_typeof(a) <> 'object' then
    return false;
  end if;
  -- 8 KB serialised, 32 keys: generous for real records, far below anything
  -- that could be used to smuggle a payload into the row.
  if octet_length(a::text) > 8192 then
    return false;
  end if;
  if (select count(*) from jsonb_object_keys(a)) > 32 then
    return false;
  end if;

  for k, v in select key, value from jsonb_each(a) loop
    if k !~ '^[a-z][a-z0-9_]{0,39}$' then
      return false;
    end if;
    case jsonb_typeof(v)
      when 'object' then
        return false;
      when 'array' then
        if jsonb_array_length(v) > 64 then
          return false;
        end if;
        for e in select value from jsonb_array_elements(v) loop
          if jsonb_typeof(e) in ('object', 'array') then
            return false;
          end if;
        end loop;
      else
        null; -- string / number / boolean / null are all fine
    end case;
  end loop;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- item_types — the type registry that replaces the hardcoded category array.
--
-- Core rows are global (user_id null) and cannot be edited by users. Custom
-- rows belong to one user. Categories in the UI are generated from this table.
-- ---------------------------------------------------------------------------
create table public.item_types (
  id uuid primary key default gen_random_uuid(),
  -- null = built-in type shared by every user
  user_id uuid references auth.users (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  singular text not null check (length(trim(singular)) between 1 and 40),
  plural text not null check (length(trim(plural)) between 1 and 40),
  icon text not null check (icon = any (public.meos_allowed_icons())),
  color text not null check (color = any (public.meos_allowed_colors())),
  kind text not null check (kind in ('core', 'custom')),
  -- Which built-in behaviour this type inherits. A custom "medication" type
  -- with default_capability 'record' is browsable and searchable; one with
  -- 'task' can also be completed. Custom types never invent behaviour.
  default_capability text not null default 'record' check (default_capability in (
    'task', 'reminder', 'event', 'list', 'person', 'document',
    'recipe', 'preference', 'record', 'note', 'unsorted'
  )),
  -- [{ "key": "...", "label": "...", "type": "text|number|date|boolean|select",
  --    "options": [...], "required": bool }]
  field_schema jsonb not null default '[]'::jsonb,
  -- Hidden types stay queryable for existing items but leave the filter rail.
  hidden boolean not null default false,
  -- Set when the user merges this type into another; reads follow the pointer.
  merged_into text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint item_types_core_is_global check ((kind = 'core') = (user_id is null)),
  constraint item_types_field_schema_array check (jsonb_typeof(field_schema) = 'array'),
  constraint item_types_field_schema_size check (octet_length(field_schema::text) <= 8192)
);

-- Partial uniques rather than `unique nulls not distinct`, which needs PG15+.
create unique index item_types_core_key_idx
  on public.item_types (key) where user_id is null;
create unique index item_types_user_key_idx
  on public.item_types (user_id, key) where user_id is not null;
create index item_types_user_idx on public.item_types (user_id) where user_id is not null;

create trigger item_types_updated_at
  before update on public.item_types
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- items — the universal row.
--
-- `type_key` is a soft reference to item_types: a hard FK is impossible
-- because the target may be either a global or a per-user row. It is validated
-- in save_items_v2(), which is the only writer.
-- ---------------------------------------------------------------------------
create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type_key text not null,
  -- Closed set: the behaviour the app knows how to implement. A custom type
  -- always maps onto one of these so it inherits working behaviour.
  capability text not null check (capability in (
    'task', 'reminder', 'event', 'list', 'person', 'document',
    'recipe', 'preference', 'record', 'note', 'unsorted'
  )),

  title text not null check (length(trim(title)) between 1 and 300),
  summary text check (length(summary) <= 2000),
  status text not null default 'active' check (status in (
    'active', 'done', 'archived', 'needs_review'
  )),
  priority smallint check (priority between 0 and 3),
  tags text[] not null default '{}',
  attributes jsonb not null default '{}'::jsonb,

  -- Temporal. `timezone` records the zone the user meant, so a stored instant
  -- can always be rendered back in the zone it was created in.
  starts_at timestamptz,
  ends_at timestamptz,
  due_at timestamptz,
  all_day boolean not null default false,
  timezone text,
  rrule text check (rrule is null or length(rrule) <= 500),
  completed_at timestamptz,

  confidence real check (confidence between 0 and 1),
  source_entry_id uuid references public.inbox_entries (id) on delete set null,
  source_text text,

  -- Bridge to the pre-v2 tables.
  legacy_table text check (legacy_table in (
    'people', 'important_dates', 'reminders', 'food_preferences',
    'recipes', 'documents', 'notes'
  )),
  legacy_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint items_attributes_valid check (public.meos_attributes_ok(attributes)),
  constraint items_legacy_pair check ((legacy_table is null) = (legacy_id is null)),
  constraint items_range_ordered check (ends_at is null or starts_at is null or ends_at >= starts_at),
  constraint items_tags_bounded check (array_length(tags, 1) is null or array_length(tags, 1) <= 24)
);

-- Keeps status and completed_at from ever disagreeing, whoever does the write.
create or replace function public.items_sync_completion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'done' then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger items_sync_completion_trg
  before insert or update on public.items
  for each row execute function public.items_sync_completion();

create trigger items_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

create index items_user_created_idx on public.items (user_id, created_at desc);
create index items_user_type_idx on public.items (user_id, type_key);
create index items_user_status_idx on public.items (user_id, status);
create index items_user_capability_idx on public.items (user_id, capability);
-- Today's two hot queries: what's due, and what's scheduled.
create index items_user_due_idx on public.items (user_id, due_at)
  where status = 'active' and due_at is not null;
create index items_user_starts_idx on public.items (user_id, starts_at)
  where starts_at is not null;
create index items_legacy_idx on public.items (legacy_table, legacy_id)
  where legacy_table is not null;
create index items_attributes_gin on public.items using gin (attributes jsonb_path_ops);
create index items_tags_gin on public.items using gin (tags);
create index items_search_idx on public.items using gin (
  to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, ''))
);

-- ---------------------------------------------------------------------------
-- item_relations — typed, queryable edges.
--
-- Distinct from the pre-v2 `entity_links` table, which is untyped, written by
-- the old save path and read by nothing. Edges here can point at another item
-- or at a legacy row, never both.
-- ---------------------------------------------------------------------------
create table public.item_relations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  from_item uuid not null references public.items (id) on delete cascade,
  to_item uuid references public.items (id) on delete cascade,
  to_legacy_table text check (to_legacy_table in (
    'people', 'important_dates', 'reminders', 'food_preferences',
    'recipes', 'documents', 'notes'
  )),
  to_legacy_id uuid,
  relation text not null check (relation in (
    'uses_list', 'involves', 'belongs_to', 'refers_to', 'part_of',
    'occurs_at', 'for_person', 'about', 'ingredient_of', 'related_to'
  )),
  created_at timestamptz not null default now(),

  constraint item_relations_one_target check ((to_item is null) <> (to_legacy_table is null)),
  constraint item_relations_legacy_pair check ((to_legacy_table is null) = (to_legacy_id is null)),
  constraint item_relations_no_self check (to_item is null or to_item <> from_item)
);

-- Coalesced expression index because plain UNIQUE treats NULLs as distinct,
-- which would let the same edge be inserted repeatedly.
create unique index item_relations_unique_idx on public.item_relations (
  from_item,
  relation,
  coalesce(to_item, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(to_legacy_table, ''),
  coalesce(to_legacy_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
create index item_relations_from_idx on public.item_relations (from_item);
create index item_relations_to_item_idx on public.item_relations (to_item) where to_item is not null;
create index item_relations_to_legacy_idx on public.item_relations (to_legacy_table, to_legacy_id)
  where to_legacy_table is not null;
create index item_relations_user_idx on public.item_relations (user_id);

-- ---------------------------------------------------------------------------
-- list_items — ordered, checkable children of an item with capability 'list'.
-- ---------------------------------------------------------------------------
create table public.list_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  list_id uuid not null references public.items (id) on delete cascade,
  position integer not null default 0 check (position >= 0),
  text text not null check (length(trim(text)) between 1 and 300),
  quantity numeric check (quantity >= 0),
  unit text check (length(unit) <= 24),
  note text check (length(note) <= 500),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index list_items_list_idx on public.list_items (list_id, position);
create index list_items_user_idx on public.list_items (user_id);
create index list_items_open_idx on public.list_items (list_id) where checked_at is null;

create trigger list_items_updated_at
  before update on public.list_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.item_types enable row level security;

-- Core types are readable by everyone signed in; only custom rows are writable,
-- and only by their owner. This is what stops a user editing a built-in type.
create policy "item_types_select_own_or_core" on public.item_types
  for select using (user_id is null or (select auth.uid()) = user_id);
create policy "item_types_insert_own" on public.item_types
  for insert with check ((select auth.uid()) = user_id and kind = 'custom');
create policy "item_types_update_own" on public.item_types
  for update using ((select auth.uid()) = user_id and kind = 'custom')
  with check ((select auth.uid()) = user_id and kind = 'custom');
create policy "item_types_delete_own" on public.item_types
  for delete using ((select auth.uid()) = user_id and kind = 'custom');

do $$
declare
  t text;
begin
  foreach t in array array['items', 'item_relations', 'list_items']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select using ((select auth.uid()) = user_id)',
      t || '_select_own', t
    );
    execute format(
      'create policy %I on public.%I for insert with check ((select auth.uid()) = user_id)',
      t || '_insert_own', t
    );
    execute format(
      'create policy %I on public.%I for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      t || '_update_own', t
    );
    execute format(
      'create policy %I on public.%I for delete using ((select auth.uid()) = user_id)',
      t || '_delete_own', t
    );
  end loop;
end;
$$;

grant select, insert, update, delete on public.item_types to authenticated;
grant select, insert, update, delete on public.items to authenticated;
grant select, insert, update, delete on public.item_relations to authenticated;
grant select, insert, update, delete on public.list_items to authenticated;

-- ---------------------------------------------------------------------------
-- Seed the core types.
--
-- These are capabilities, not folders: each one exists because the app
-- implements behaviour for it. `on conflict do nothing` keeps the migration
-- safe to re-run.
-- ---------------------------------------------------------------------------
insert into public.item_types
  (user_id, key, singular, plural, icon, color, kind, default_capability, field_schema)
values
  (null, 'task', 'Task', 'Tasks', 'check', 'accent', 'core', 'task',
   '[{"key":"location","label":"Where","type":"text"}]'::jsonb),
  (null, 'list', 'List', 'Lists', 'list', 'accent', 'core', 'list',
   '[{"key":"list_kind","label":"Kind","type":"select","options":["shopping","packing","todo","general"]}]'::jsonb),
  (null, 'event', 'Event', 'Events', 'calendar', 'date', 'core', 'event',
   '[{"key":"location","label":"Where","type":"text"}]'::jsonb),
  (null, 'reminder', 'Reminder', 'Reminders', 'repeat', 'reminder', 'core', 'reminder', '[]'::jsonb),
  (null, 'person', 'Person', 'People', 'user', 'person', 'core', 'person', '[]'::jsonb),
  (null, 'document', 'Document', 'Documents', 'file-text', 'document', 'core', 'document', '[]'::jsonb),
  (null, 'recipe', 'Recipe', 'Recipes', 'cup-soda', 'recipe', 'core', 'recipe', '[]'::jsonb),
  (null, 'preference', 'Preference', 'Preferences', 'heart', 'food', 'core', 'preference', '[]'::jsonb),
  (null, 'note', 'Note', 'Notes', 'clipboard', 'note', 'core', 'note', '[]'::jsonb),
  -- Not a bucket for anything unrecognised: a first-class review queue, so the
  -- app can say "I kept this but I don't know what it is" instead of lying.
  (null, 'unsorted', 'Needs review', 'Needs review', 'sparkles', 'warning', 'core', 'unsorted', '[]'::jsonb)
on conflict do nothing;
