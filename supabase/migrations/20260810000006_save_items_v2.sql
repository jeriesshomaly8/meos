-- Transactional writer for the universal item layer.
--
-- Same contract as save_extracted_items(): SECURITY INVOKER so RLS still
-- applies, user_id always from auth.uid(), all-or-nothing. The v1 function is
-- left in place and still callable — the two write to different tables and
-- never to the same record.
--
-- Payload (built server-side after Zod validation, camelCase throughout):
-- {
--   "entryId": "<inbox_entries.id or null>",
--   "newTypes": [{
--     "key": "medication", "singular": "Medication", "plural": "Medications",
--     "icon": "pill", "color": "neutral", "defaultCapability": "record",
--     "fieldSchema": [...]
--   }],
--   "items": [{
--     "temporaryId": "p1",
--     "typeKey": "list",
--     "capability": "list",            -- optional; falls back to the type's
--     "title": "Shopping for today",
--     "summary": "...", "status": "active", "priority": null,
--     "tags": ["shopping"], "attributes": { "list_kind": "shopping" },
--     "startsAt": null, "endsAt": null, "dueAt": "2026-08-10T20:59:59Z",
--     "allDay": true, "timezone": "Asia/Jerusalem", "rrule": null,
--     "confidence": 0.93, "sourceText": "make a shopping list for today...",
--     "listItems": [{ "text": "milk", "quantity": null, "unit": null }],
--     "relations": [
--       { "relation": "involves", "targetRef": "p2" },
--       { "relation": "for_person", "legacyTable": "people", "legacyId": "<uuid>" }
--     ]
--   }]
-- }

create or replace function public.save_items_v2(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_entry_id uuid;
  t jsonb;
  item jsonb;
  li jsonb;
  rel jsonb;
  v_id uuid;
  v_type_key text;
  v_capability text;
  v_type_capability text;
  v_target uuid;
  v_ref text;
  v_pos integer;
  id_map jsonb := '{}'::jsonb;
  created jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- 1. Custom types the user approved on the confirmation screen.
  --
  -- Inserted as ordinary rows — the model never issues DDL. Table constraints
  -- enforce the key format and the approved icon/colour sets, so a malformed
  -- proposal aborts the whole transaction rather than half-saving.
  for t in select value from jsonb_array_elements(coalesce(payload -> 'newTypes', '[]'::jsonb)) loop
    insert into public.item_types (
      user_id, key, singular, plural, icon, color, kind, default_capability, field_schema
    )
    values (
      v_user_id,
      t ->> 'key',
      t ->> 'singular',
      t ->> 'plural',
      t ->> 'icon',
      t ->> 'color',
      'custom',
      coalesce(t ->> 'defaultCapability', 'record'),
      coalesce(t -> 'fieldSchema', '[]'::jsonb)
    )
    on conflict do nothing;  -- re-approving an existing type is a no-op
  end loop;

  -- 2. Items.
  for item in select value from jsonb_array_elements(coalesce(payload -> 'items', '[]'::jsonb)) loop
    v_type_key := item ->> 'typeKey';

    -- The type must already exist, globally or for this user. This is what
    -- stops an arbitrary string from the model becoming a category.
    select it.default_capability into v_type_capability
    from public.item_types it
    where it.key = v_type_key
      and (it.user_id is null or it.user_id = v_user_id)
    order by it.user_id nulls last
    limit 1;

    if v_type_capability is null then
      raise exception 'unknown item type: %', v_type_key using errcode = '22023';
    end if;

    v_capability := coalesce(item ->> 'capability', v_type_capability);

    insert into public.items (
      user_id, type_key, capability, title, summary, status, priority, tags,
      attributes, starts_at, ends_at, due_at, all_day, timezone, rrule,
      confidence, source_entry_id, source_text
    )
    values (
      v_user_id,
      v_type_key,
      v_capability,
      item ->> 'title',
      item ->> 'summary',
      coalesce(item ->> 'status', 'active'),
      (item ->> 'priority')::smallint,
      coalesce(
        (select array_agg(value::text) from jsonb_array_elements_text(item -> 'tags') as value),
        '{}'::text[]
      ),
      coalesce(item -> 'attributes', '{}'::jsonb),
      (item ->> 'startsAt')::timestamptz,
      (item ->> 'endsAt')::timestamptz,
      (item ->> 'dueAt')::timestamptz,
      coalesce((item ->> 'allDay')::boolean, false),
      item ->> 'timezone',
      item ->> 'rrule',
      (item ->> 'confidence')::real,
      public.try_uuid(payload ->> 'entryId'),
      item ->> 'sourceText'
    )
    returning id into v_id;

    -- 3. List children, position taken from array order.
    v_pos := 0;
    for li in select value from jsonb_array_elements(coalesce(item -> 'listItems', '[]'::jsonb)) loop
      insert into public.list_items (user_id, list_id, position, text, quantity, unit, note)
      values (
        v_user_id,
        v_id,
        v_pos,
        li ->> 'text',
        (li ->> 'quantity')::numeric,
        li ->> 'unit',
        li ->> 'note'
      );
      v_pos := v_pos + 1;
    end loop;

    id_map := id_map || jsonb_build_object(item ->> 'temporaryId', v_id::text);
    created := created || jsonb_build_object(
      'temporaryId', item ->> 'temporaryId',
      'id', v_id,
      'typeKey', v_type_key,
      'capability', v_capability
    );
  end loop;

  -- 4. Relations, after every item exists so temporaryIds all resolve.
  for item in select value from jsonb_array_elements(coalesce(payload -> 'items', '[]'::jsonb)) loop
    if not (id_map ? (item ->> 'temporaryId')) then
      continue;
    end if;

    for rel in select value from jsonb_array_elements(coalesce(item -> 'relations', '[]'::jsonb)) loop
      if rel ->> 'legacyTable' is not null then
        insert into public.item_relations (
          user_id, from_item, to_legacy_table, to_legacy_id, relation
        )
        values (
          v_user_id,
          (id_map ->> (item ->> 'temporaryId'))::uuid,
          rel ->> 'legacyTable',
          public.try_uuid(rel ->> 'legacyId'),
          rel ->> 'relation'
        )
        on conflict do nothing;
      else
        v_ref := rel ->> 'targetRef';
        if id_map ? v_ref then
          v_target := (id_map ->> v_ref)::uuid;
        else
          -- A real item id is acceptable too, but only if the caller owns it.
          select i.id into v_target
          from public.items i
          where i.id = public.try_uuid(v_ref) and i.user_id = v_user_id;
        end if;

        -- Silently skipping an unresolvable edge is correct: the item itself
        -- is still worth saving, and a dangling relation is not.
        if v_target is not null and v_target <> (id_map ->> (item ->> 'temporaryId'))::uuid then
          insert into public.item_relations (user_id, from_item, to_item, relation)
          values (
            v_user_id,
            (id_map ->> (item ->> 'temporaryId'))::uuid,
            v_target,
            rel ->> 'relation'
          )
          on conflict do nothing;
        end if;
      end if;
    end loop;
  end loop;

  v_entry_id := public.try_uuid(payload ->> 'entryId');
  if v_entry_id is not null then
    update public.inbox_entries
    set processing_status = 'confirmed'
    where id = v_entry_id and user_id = v_user_id;
  end if;

  return jsonb_build_object('created', created);
end;
$$;

-- ---------------------------------------------------------------------------
-- Toggling a list item and a task, as functions so the UI never needs an
-- update policy loophole and the status/completed_at pair stays consistent.
-- ---------------------------------------------------------------------------
create or replace function public.set_list_item_checked(p_id uuid, p_checked boolean)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.list_items
  set checked_at = case when p_checked then now() else null end
  where id = p_id and user_id = auth.uid();
  if not found then
    raise exception 'list item not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.set_item_done(p_id uuid, p_done boolean)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- completed_at is maintained by the items_sync_completion trigger.
  update public.items
  set status = case when p_done then 'done' else 'active' end
  where id = p_id and user_id = auth.uid();
  if not found then
    raise exception 'item not found' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Replaces the v1 wipe, which would now leave universal items behind — a
-- privacy bug, not just an omission. Custom type definitions go too: they are
-- derived from the user's own data.
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

  -- v2 layer first: item_relations and list_items cascade from items, but
  -- deleting explicitly keeps this readable and order-independent.
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

grant execute on function public.save_items_v2(jsonb) to authenticated;
grant execute on function public.set_list_item_checked(uuid, boolean) to authenticated;
grant execute on function public.set_item_done(uuid, boolean) to authenticated;
