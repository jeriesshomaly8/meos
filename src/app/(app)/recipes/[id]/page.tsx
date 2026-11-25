import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { RecipeIngredientRow, RecipeRow } from "@/lib/types";
import { Screen, ScreenHeader } from "@/components/kit/screen";
import { Section } from "@/components/kit/section";
import { DeleteRecordButton } from "@/components/delete-record-button";
import { IngredientChecklist } from "./ingredient-checklist";

export const metadata: Metadata = { title: "Recipe" };

export default async function RecipePage(props: PageProps<"/recipes/[id]">) {
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: recipe } = await supabase
    .from("recipes")
    .select(
      "id, name, description, preparation_time_minutes, cooking_time_minutes, servings, instructions, notes",
    )
    .eq("id", id)
    .maybeSingle<RecipeRow>();

  if (!recipe) {
    notFound();
  }

  const { data: ingredientRows } = await supabase
    .from("recipe_ingredients")
    .select("id, ingredient_name, quantity, unit, optional, notes")
    .eq("recipe_id", id)
    .order("id");

  const ingredients = (ingredientRows ?? []) as Pick<
    RecipeIngredientRow,
    "id" | "ingredient_name" | "quantity" | "unit" | "optional" | "notes"
  >[];

  const steps = (recipe.instructions ?? "")
    .split("\n")
    .map((step) => step.trim())
    .filter(Boolean);

  const facts = [
    recipe.preparation_time_minutes !== null
      ? { label: "Prep", value: `${recipe.preparation_time_minutes} min` }
      : null,
    recipe.cooking_time_minutes !== null
      ? { label: "Cook", value: `${recipe.cooking_time_minutes} min` }
      : null,
    recipe.servings !== null ? { label: "Serves", value: `${recipe.servings}` } : null,
  ].filter((fact): fact is { label: string; value: string } => fact !== null);

  return (
    <Screen>
      <ScreenHeader
        backHref="/recipes"
        backLabel="Recipes"
        title={recipe.name}
        description={recipe.description ?? undefined}
        action={
          <DeleteRecordButton
            table="recipes"
            id={recipe.id}
            label={recipe.name}
            redirectTo="/recipes"
          />
        }
      />

      {facts.length > 0 && (
        /* A stat strip rather than three badges: prep/cook/serves are the
           numbers a cook checks before starting, so they get real hierarchy. */
        <dl className="flex overflow-hidden rounded-lg bg-card shadow-card">
          {facts.map((fact, index) => (
            <div
              key={fact.label}
              className={`flex flex-1 flex-col items-center gap-0.5 px-3 py-3.5 ${
                index > 0 ? "border-s border-hairline" : ""
              }`}
            >
              <dt className="text-2xs font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                {fact.label}
              </dt>
              <dd data-numeric className="font-display text-lg">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <IngredientChecklist
        recipeName={recipe.name}
        ingredients={ingredients.map((ing) => ({
          id: ing.id,
          name: ing.ingredient_name,
          quantity: ing.quantity,
          unit: ing.unit,
          optional: ing.optional,
          notes: ing.notes,
        }))}
      />

      <Section title="Method">
        {steps.length === 0 ? (
          <p className="rounded-lg bg-card px-6 py-8 text-center text-base text-muted-foreground shadow-card">
            No instructions saved for this one.
          </p>
        ) : (
          <ol className="flex flex-col gap-3 rounded-lg bg-card p-4 shadow-card">
            {steps.map((step, index) => (
              <li key={index} className="flex gap-3">
                <span
                  data-numeric
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-cat-recipe/10 text-sm font-semibold text-cat-recipe"
                >
                  {index + 1}
                </span>
                <p className="pt-0.5 text-base leading-relaxed">{step}</p>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {recipe.notes && (
        <Section title="Notes">
          <p className="whitespace-pre-wrap rounded-lg bg-card p-4 text-base shadow-card">
            {recipe.notes}
          </p>
        </Section>
      )}
    </Screen>
  );
}
