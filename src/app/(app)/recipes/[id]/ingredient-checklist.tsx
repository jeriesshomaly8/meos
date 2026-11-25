"use client";

import { useState } from "react";
import { Check, ListTodo } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Section } from "@/components/kit/section";

interface Ingredient {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  optional: boolean;
  notes: string | null;
}

function ingredientLabel(ingredient: Ingredient): string {
  const amount = [ingredient.quantity, ingredient.unit].filter((v) => v !== null).join(" ");
  return amount ? `${amount} ${ingredient.name}` : ingredient.name;
}

export function IngredientChecklist({
  recipeName,
  ingredients,
}: {
  recipeName: string;
  ingredients: Ingredient[];
}) {
  // Checked = "I have this at home"; the shopping list is everything unchecked.
  const [checked, setChecked] = useState<Set<string>>(new Set());

  async function copyShoppingList() {
    const missing = ingredients.filter((ing) => !checked.has(ing.id));
    if (missing.length === 0) {
      toast.success("You have everything — nothing to buy!");
      return;
    }
    const list = [
      `Shopping list — ${recipeName}`,
      ...missing.map((ing) => `- ${ingredientLabel(ing)}${ing.optional ? " (optional)" : ""}`),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(list);
      toast.success(`Shopping list copied (${missing.length} items).`);
    } catch {
      toast.error("Couldn't access the clipboard.");
    }
  }

  const remaining = ingredients.length - checked.size;

  return (
    <Section title="Ingredients">
      {ingredients.length === 0 ? (
        <p className="rounded-lg bg-card px-6 py-8 text-center text-base text-muted-foreground shadow-card">
          No ingredients saved for this one.
        </p>
      ) : (
        <>
          <p className="-mt-1 px-1 text-sm text-muted-foreground">
            Tick what you already have at home.
          </p>

          <ul className="overflow-hidden rounded-lg bg-card shadow-card">
            {ingredients.map((ingredient) => {
              const isChecked = checked.has(ingredient.id);
              return (
                <li key={ingredient.id}>
                  {/* Whole row is the target — a 16px checkbox is a miserable
                      thing to hit with flour on your hands. */}
                  <button
                    type="button"
                    aria-pressed={isChecked}
                    onClick={() =>
                      setChecked((current) => {
                        const next = new Set(current);
                        if (isChecked) next.delete(ingredient.id);
                        else next.add(ingredient.id);
                        return next;
                      })
                    }
                    className="relative flex w-full min-h-[3.25rem] items-center gap-3 px-4 py-2.5 text-start transition-colors after:absolute after:inset-x-4 after:top-0 after:h-px after:bg-hairline active:bg-secondary/60 first:after:hidden"
                  >
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-150",
                        isChecked
                          ? "border-cat-recipe bg-cat-recipe text-white"
                          : "border-input text-transparent",
                      )}
                      aria-hidden
                    >
                      <Check className="size-3.5" strokeWidth={3} />
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 text-base leading-snug",
                        isChecked && "text-muted-foreground line-through",
                      )}
                    >
                      {ingredientLabel(ingredient)}
                      {ingredient.optional && (
                        <span className="text-muted-foreground"> (optional)</span>
                      )}
                      {ingredient.notes && (
                        <span className="block text-sm text-muted-foreground no-underline">
                          {ingredient.notes}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            onClick={copyShoppingList}
            className="flex h-12 items-center justify-center gap-2 rounded-lg bg-card text-body font-medium shadow-card transition-colors active:bg-secondary"
          >
            <ListTodo className="size-4.5 text-cat-recipe" aria-hidden />
            {remaining > 0 ? `Copy shopping list (${remaining})` : "Copy shopping list"}
          </button>
        </>
      )}
    </Section>
  );
}
