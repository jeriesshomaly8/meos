-- Row-level security: every table holding private data is locked to its owner.
-- Policies use (select auth.uid()) so the planner can treat it as a stable
-- initplan instead of re-evaluating per row.

-- profiles -------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using ((select auth.uid()) = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles
  for update using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "profiles_delete_own" on public.profiles
  for delete using ((select auth.uid()) = id);

-- Owner-scoped tables share the same four policies.
do $$
declare
  t text;
begin
  foreach t in array array[
    'people',
    'person_preferences',
    'important_dates',
    'reminders',
    'food_preferences',
    'recipes',
    'documents',
    'notes',
    'inbox_entries',
    'entity_links'
  ]
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

-- recipe_ingredients has no user_id; ownership flows through the recipe.
alter table public.recipe_ingredients enable row level security;

create policy "recipe_ingredients_select_own" on public.recipe_ingredients
  for select using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id and r.user_id = (select auth.uid())
    )
  );
create policy "recipe_ingredients_insert_own" on public.recipe_ingredients
  for insert with check (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id and r.user_id = (select auth.uid())
    )
  );
create policy "recipe_ingredients_update_own" on public.recipe_ingredients
  for update using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id and r.user_id = (select auth.uid())
    )
  ) with check (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id and r.user_id = (select auth.uid())
    )
  );
create policy "recipe_ingredients_delete_own" on public.recipe_ingredients
  for delete using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id and r.user_id = (select auth.uid())
    )
  );
