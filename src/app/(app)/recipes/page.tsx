import type { Metadata } from "next";
import { ChefHat } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { RecipeRow } from "@/lib/types";
import { Screen, ScreenHeader } from "@/components/kit/screen";
import { CategoryRail } from "@/components/kit/category-rail";
import { List, ListRow } from "@/components/kit/list";
import { Empty } from "@/components/kit/empty";

export const metadata: Metadata = { title: "Recipes" };

export default async function RecipesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("recipes")
    .select(
      "id, name, description, preparation_time_minutes, cooking_time_minutes, servings, recipe_ingredients(count)",
    )
    .order("name");

  const recipes = (data ?? []) as unknown as (Pick<
    RecipeRow,
    "id" | "name" | "description" | "preparation_time_minutes" | "cooking_time_minutes" | "servings"
  > & { recipe_ingredients: { count: number }[] })[];

  return (
    <Screen>
      <ScreenHeader title="Recipes" description="Your personal cookbook." />
      <CategoryRail />

      {recipes.length === 0 ? (
        <Empty
          icon={ChefHat}
          title="No recipes yet"
          description="Paste a whole recipe into capture — MeOS pulls out the ingredients and steps for you."
        />
      ) : (
        <List>
          {recipes.map((recipe) => {
            const totalMinutes =
              (recipe.preparation_time_minutes ?? 0) + (recipe.cooking_time_minutes ?? 0);
            const ingredientCount = recipe.recipe_ingredients[0]?.count ?? 0;

            const details = [
              totalMinutes > 0 ? `${totalMinutes} min` : null,
              recipe.servings ? `serves ${recipe.servings}` : null,
              ingredientCount > 0 ? `${ingredientCount} ingredients` : null,
            ].filter(Boolean);

            return (
              <ListRow
                key={recipe.id}
                href={`/recipes/${recipe.id}`}
                icon={ChefHat}
                iconClassName="bg-cat-recipe/10 text-cat-recipe"
                title={recipe.name}
                subtitle={details.length > 0 ? details.join(" · ") : (recipe.description ?? undefined)}
              />
            );
          })}
        </List>
      )}
    </Screen>
  );
}
