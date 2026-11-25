-- Transactional save of user-approved extraction items.
-- The whole RPC runs in one transaction: either every approved item is saved
-- or none are. SECURITY INVOKER on purpose — RLS policies still apply, and
-- user_id is always taken from auth.uid(), never from the payload.
--
-- Payload shape (built server-side after Zod validation):
-- {
--   "entryId": "<inbox_entries.id or null>",
--   "items": [{
--     "temporaryId": "item-1",
--     "category": "person" | "person_preference" | "important_date" | "reminder"
--               | "food_preference" | "recipe" | "document" | "note",
--     "action": "create" | "update",
--     "existingId": "<uuid, for update>",
--     "personRef": "<temporaryId of a person item, or a real people.id uuid>",
--     "data": { ...snake_case columns for the category... },
--     "links": [{ "targetRef": "<temporaryId or uuid>", "targetType": "person",
--                 "relationshipType": "about" }]
--   }]
-- }

create or replace function public.try_uuid(p text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

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
  link jsonb;
  v_id uuid;
  v_person_id uuid;
  v_target_id uuid;
  v_ref text;
  -- temporaryId -> {"type": entity_type, "id": uuid}
  id_map jsonb := '{}'::jsonb;
  created jsonb := '[]'::jsonb;
  category_order constant text[] := array[
    'person', 'document', 'recipe', 'note', 'important_date',
    'food_preference', 'person_preference', 'reminder'
  ];
  cat text;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- First pass: create/update entities in dependency order so person
  -- references can be resolved by later categories.
  foreach cat in array category_order loop
    for item in
      select value from jsonb_array_elements(payload -> 'items')
      where value ->> 'category' = cat
    loop
      d := item -> 'data';

      -- Resolve an attached person: a temporaryId from this batch wins,
      -- otherwise accept a real uuid (RLS-checked via FK + policies).
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
              v_user_id,
              d ->> 'name',
              d ->> 'relationship',
              (d ->> 'birthday')::date,
              coalesce((d ->> 'birthday_year_known')::boolean, true),
              d ->> 'notes'
            )
            returning id into v_id;
          end if;

        when 'document' then
          insert into public.documents (
            user_id, document_type, display_name, document_number,
            issue_date, expiration_date, issuing_country, notes
          )
          values (
            v_user_id,
            d ->> 'document_type',
            d ->> 'display_name',
            d ->> 'document_number',
            (d ->> 'issue_date')::date,
            (d ->> 'expiration_date')::date,
            d ->> 'issuing_country',
            d ->> 'notes'
          )
          returning id into v_id;

        when 'recipe' then
          insert into public.recipes (
            user_id, name, description, preparation_time_minutes,
            cooking_time_minutes, servings, instructions, notes
          )
          values (
            v_user_id,
            d ->> 'name',
            d ->> 'description',
            (d ->> 'preparation_time_minutes')::integer,
            (d ->> 'cooking_time_minutes')::integer,
            (d ->> 'servings')::integer,
            d ->> 'instructions',
            d ->> 'notes'
          )
          returning id into v_id;

          for ing in select value from jsonb_array_elements(coalesce(d -> 'ingredients', '[]'::jsonb)) loop
            insert into public.recipe_ingredients (recipe_id, ingredient_name, quantity, unit, optional, notes)
            values (
              v_id,
              ing ->> 'ingredient_name',
              (ing ->> 'quantity')::numeric,
              ing ->> 'unit',
              coalesce((ing ->> 'optional')::boolean, false),
              ing ->> 'notes'
            );
          end loop;

        when 'note' then
          insert into public.notes (user_id, title, content, note_type)
          values (
            v_user_id,
            d ->> 'title',
            d ->> 'content',
            coalesce(d ->> 'note_type', 'general')
          )
          returning id into v_id;

        when 'important_date' then
          insert into public.important_dates (
            user_id, title, event_date, year_known, recurrence, person_id, notes
          )
          values (
            v_user_id,
            d ->> 'title',
            (d ->> 'event_date')::date,
            coalesce((d ->> 'year_known')::boolean, true),
            coalesce(d ->> 'recurrence', 'none'),
            v_person_id,
            d ->> 'notes'
          )
          returning id into v_id;

        when 'food_preference' then
          insert into public.food_preferences (
            user_id, person_id, food_name, preference_type, severity, notes
          )
          values (
            v_user_id,
            v_person_id,
            d ->> 'food_name',
            d ->> 'preference_type',
            d ->> 'severity',
            d ->> 'notes'
          )
          returning id into v_id;

        when 'person_preference' then
          if v_person_id is null then
            raise exception 'person_preference requires a resolvable person';
          end if;
          insert into public.person_preferences (user_id, person_id, preference_type, value, notes)
          values (
            v_user_id,
            v_person_id,
            d ->> 'preference_type',
            d ->> 'value',
            d ->> 'notes'
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
            v_user_id,
            d ->> 'title',
            (d ->> 'remind_at')::timestamptz,
            false,
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
        'temporaryId', item ->> 'temporaryId',
        'entityType', cat,
        'id', v_id
      );
    end loop;
  end loop;

  -- Second pass: explicit links between saved entities.
  for item in select value from jsonb_array_elements(payload -> 'items') loop
    if not (id_map ? (item ->> 'temporaryId')) then
      continue; -- item was excluded by the user
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

-- Full account-data wipe (Settings -> "Delete all my data").
-- Deletes rows, not the auth user; SECURITY INVOKER so RLS applies.
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
