import type { Metadata } from "next";
import { UtensilsCrossed } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { FoodPreferenceRow } from "@/lib/types";
import { Screen, ScreenHeader } from "@/components/kit/screen";
import { CategoryRail } from "@/components/kit/category-rail";
import { Empty } from "@/components/kit/empty";
import { FoodBoard, type FoodEntry } from "./food-board";

export const metadata: Metadata = { title: "Food" };

export default async function FoodPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("food_preferences")
    .select("id, food_name, preference_type, severity, notes, person_id, people(name)")
    .order("created_at", { ascending: false })
    .limit(500);

  const entries: FoodEntry[] = (
    (data ?? []) as unknown as (Pick<
      FoodPreferenceRow,
      "id" | "food_name" | "preference_type" | "severity" | "notes" | "person_id"
    > & { people: { name: string } | null })[]
  ).map((row) => ({
    id: row.id,
    foodName: row.food_name,
    preferenceType: row.preference_type,
    severity: row.severity,
    notes: row.notes,
    personName: row.people?.name ?? null,
  }));

  return (
    <Screen>
      <ScreenHeader title="Food" description="Who eats what — and what to avoid." />
      <CategoryRail />

      {entries.length === 0 ? (
        <Empty
          icon={UtensilsCrossed}
          title="No food notes yet"
          description='Try "Dad hates cilantro" or "Maya is severely allergic to peanuts."'
        />
      ) : (
        <FoodBoard entries={entries} />
      )}
    </Screen>
  );
}
