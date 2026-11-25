-- Teaches the existing transactional writer about tasks and lists.
--
-- Why extend save_extracted_items() rather than route these through
-- save_items_v2(): one capture can produce a shopping list AND a person AND a
-- food preference. Two RPCs would be two transactions, and a half-saved
-- capture is exactly the failure the single-writer design exists to prevent.
-- So the v1 writer gains two branches that write into the v2 tables, and every
-- approved item from one capture still lands atomically.
--
-- Additive: the seven original branches are byte-identical to migration 0003.
-- Rollback is `create or replace` back to the 0003 body.

create or replace function public.save_extracted_items(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_entry_id uuid;
  item jsonb;
  d jsonb;
  ing jsonb;
  li jsonb;
  link jsonb;
  v_id uuid;
  v_person_id uuid;
  v_target_id uuid;
  v_ref text;
  v_pos integer;
  id_map jsonb := '{}'::jsonb;
  created jsonb := '[]'::jsonb;
  -- 'list' before 'task' so a task can reference the list it uses.
  category_order constant text[] := array[
    'person', 'document', 'recipe', 'note', 'important_date',
    'food_preference', 'person_preference', 'list', 'task', 'reminder'
  ];
  cat text;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  foreach cat in array category_order loop
    for item in
      select value from jsonb_array_elements(payload -> 'items')
      where value ->> 'category' = cat
    loop
      d := item -> 'data';

      v_person_id := null;
      v_ref := item ->> 'personRef';
      if v_ref is not null then
        if id_map ? v_ref then
          v_person_id := (id_map -> v_ref ->> 'id')::uuid;
        else
          select p.id into v_person_id
          from public.people p
          where p.id = public.try_uuid(v_ref) and p.user_id = v_user_id;
        end if;
      end if;

      case cat
        when 'person' then
          if item ->> 'action' = 'update' and public.try_uuid(item ->> 'existingId') is not null then
            update public.people set
              relationship = coalesce(d ->> 'relationship', relationship),
              birthday = coalesce((d ->> 'birthday')::date, birthday),
              birthday_year_known = coalesce((d ->> 'birthday_year_known')::boolean, birthday_year_known),
              notes = case
                when d ->> 'notes' is null then notes
                when notes is null then d ->> 'notes'
                else notes || E'\n' || (d ->> 'notes')
              end
            where id = (item ->> 'existingId')::uuid and user_id = v_user_id
            returning id into v_id;
            if v_id is null then
              raise exception 'person to update not found';
            end if;
          else
            insert into public.people (user_id, name, relationship, birthday, birthday_year_known, notes)
            values (
              v_user_id, d ->> 'name', d ->> 'relationship', (d ->> 'birthday')::date,
              coalesce((d ->> 'birthday_year_known')::boolean, true), d ->> 'notes'
            )
            returning id into v_id;
          end if;

        when 'document' then
          insert into public.documents (
            user_id, document_type, display_name, document_number,
            issue_date, expiration_date, issuing_country, notes
          )
          values (
            v_user_id, d ->> 'document_type', d ->> 'display_name', d ->> 'document_number',
            (d ->> 'issue_date')::date, (d ->> 'expiration_date')::date,
            d ->> 'issuing_country', d ->> 'notes'
          )
          returning id into v_id;

        when 'recipe' then
          insert into public.recipes (
            user_id, name, description, preparation_time_minutes,
            cooking_time_minutes, servings, instructions, notes
          )
          values (
            v_user_id, d ->> 'name', d ->> 'description',
            (d ->> 'preparation_time_minutes')::integer,
            (d ->> 'cooking_time_minutes')::integer, (d ->> 'servings')::integer,
            d ->> 'instructions', d ->> 'notes'
          )
          returning id into v_id;

          for ing in select value from jsonb_array_elements(coalesce(d -> 'ingredients', '[]'::jsonb)) loop
            insert into public.recipe_ingredients (recipe_id, ingredient_name, quantity, unit, optional, notes)
            values (
              v_id, ing ->> 'ingredient_name', (ing ->> 'quantity')::numeric,
              ing ->> 'unit', coalesce((ing ->> 'optional')::boolean, false), ing ->> 'notes'
            );
          end loop;

        when 'note' then
          insert into public.notes (user_id, title, content, note_type)
          values (v_user_id, d ->> 'title', d ->> 'content', coalesce(d ->> 'note_type', 'general'))
          returning id into v_id;

        when 'important_date' then
          insert into public.important_dates (
            user_id, title, event_date, year_known, recurrence, person_id, notes
          )
          values (
            v_user_id, d ->> 'title', (d ->> 'event_date')::date,
            coalesce((d ->> 'year_known')::boolean, true),
            coalesce(d ->> 'recurrence', 'none'), v_person_id, d ->> 'notes'
          )
          returning id into v_id;

        when 'food_preference' then
          insert into public.food_preferences (
            user_id, person_id, food_name, preference_type, severity, notes
          )
          values (
            v_user_id, v_person_id, d ->> 'food_name', d ->> 'preference_type',
            d ->> 'severity', d ->> 'notes'
          )
          returning id into v_id;

        when 'person_preference' then
          if v_person_id is null then
            raise exception 'person_preference requires a resolvable person';
          end if;
          insert into public.person_preferences (user_id, person_id, preference_type, value, notes)
          values (v_user_id, v_person_id, d ->> 'preference_type', d ->> 'value', d ->> 'notes')
          returning id into v_id;

        -- ── v2 capabilities, written into the universal tables ──────────────
        when 'list' then
          insert into public.items (
            user_id, type_key, capability, title, summary, status,
            attributes, due_at, all_day, timezone, confidence,
            source_entry_id, source_text
          )
          values (
            v_user_id, 'list', 'list',
            d ->> 'title',
            d ->> 'summary',
            'active',
            jsonb_strip_nulls(jsonb_build_object(
              'list_kind', d ->> 'list_kind',
              'date_phrase', d ->> 'date_phrase'
            )),
            (d ->> 'due_at')::timestamptz,
            coalesce((d ->> 'all_day')::boolean, true),
            payload ->> 'timezone',
            (d ->> 'confidence')::real,
            public.try_uuid(payload ->> 'entryId'),
            d ->> 'source_text'
          )
          returning id into v_id;

          -- Every entry is its own checkable row; position follows array order.
          v_pos := 0;
          for li in select value from jsonb_array_elements(coalesce(d -> 'list_items', '[]'::jsonb)) loop
            insert into public.list_items (user_id, list_id, position, text, quantity, unit)
            values (
              v_user_id, v_id, v_pos, li ->> 'text',
              (li ->> 'quantity')::numeric, li ->> 'unit'
            );
            v_pos := v_pos + 1;
          end loop;

        when 'task' then
          insert into public.items (
            user_id, type_key, capability, title, summary, status,
            attributes, due_at, all_day, timezone, confidence,
            source_entry_id, source_text
          )
          values (
            v_user_id, 'task', 'task',
            d ->> 'title',
            d ->> 'summary',
            'active',
            jsonb_strip_nulls(jsonb_build_object('date_phrase', d ->> 'date_phrase')),
            (d ->> 'due_at')::timestamptz,
            coalesce((d ->> 'all_day')::boolean, true),
            payload ->> 'timezone',
            (d ->> 'confidence')::real,
            public.try_uuid(payload ->> 'entryId'),
            d ->> 'source_text'
          )
          returning id into v_id;

        when 'reminder' then
          v_target_id := null;
          v_ref := d ->> 'related_ref';
          if v_ref is not null then
            if id_map ? v_ref then
              v_target_id := (id_map -> v_ref ->> 'id')::uuid;
            else
              v_target_id := public.try_uuid(v_ref);
            end if;
          end if;
          insert into public.reminders (
            user_id, title, remind_at, completed, related_entity_type, related_entity_id
          )
          values (
            v_user_id, d ->> 'title', (d ->> 'remind_at')::timestamptz, false,
            case when v_target_id is null then null else d ->> 'related_entity_type' end,
            v_target_id
          )
          returning id into v_id;
      end case;

      id_map := id_map || jsonb_build_object(
        item ->> 'temporaryId',
        jsonb_build_object(
          'type', case cat when 'person_preference' then 'person' else cat end,
          'id', v_id
        )
      );
      created := created || jsonb_build_object(
        'temporaryId', item ->> 'temporaryId', 'entityType', cat, 'id', v_id
      );
    end loop;
  end loop;

  -- Links. Edges between two universal items go in item_relations, which is
  -- typed and actually read by the app; everything else keeps using the older
  -- entity_links table so nothing existing changes shape.
  for item in select value from jsonb_array_elements(payload -> 'items') loop
    if not (id_map ? (item ->> 'temporaryId')) then
      continue;
    end if;
    for link in select value from jsonb_array_elements(coalesce(item -> 'links', '[]'::jsonb)) loop
      v_ref := link ->> 'targetRef';
      v_target_id := null;
      if id_map ? v_ref then
        v_target_id := (id_map -> v_ref ->> 'id')::uuid;
      else
        v_target_id := public.try_uuid(v_ref);
      end if;
      if v_target_id is null then
        continue;
      end if;

      if (id_map -> (item ->> 'temporaryId') ->> 'type') in ('task', 'list')
         and coalesce(link ->> 'targetType', '') in ('task', 'list') then
        insert into public.item_relations (user_id, from_item, to_item, relation)
        values (
          v_user_id,
          (id_map -> (item ->> 'temporaryId') ->> 'id')::uuid,
          v_target_id,
          case when link ->> 'targetType' = 'list' then 'uses_list' else 'related_to' end
        )
        on conflict do nothing;
      else
        insert into public.entity_links (
          user_id, source_entity_type, source_entity_id,
          target_entity_type, target_entity_id, relationship_type
        )
        values (
          v_user_id,
          (id_map -> (item ->> 'temporaryId') ->> 'type'),
          (id_map -> (item ->> 'temporaryId') ->> 'id')::uuid,
          coalesce(link ->> 'targetType', 'person'),
          v_target_id,
          coalesce(link ->> 'relationshipType', 'related_to')
        );
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
