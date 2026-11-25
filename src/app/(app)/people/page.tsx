import type { Metadata } from "next";
import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatEventDate } from "@/lib/dates";
import { initials } from "@/lib/initials";
import type { PersonRow } from "@/lib/types";
import { Screen, ScreenHeader } from "@/components/kit/screen";
import { CategoryRail } from "@/components/kit/category-rail";
import { List, ListRow } from "@/components/kit/list";
import { Empty } from "@/components/kit/empty";
import { ImportContactsButton } from "@/components/people/import-contacts-button";

export const metadata: Metadata = { title: "People" };

export default async function PeoplePage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("people")
    .select(
      "id, name, relationship, birthday, birthday_year_known, notes, food_preferences(count), person_preferences(count)",
    )
    .order("name", { ascending: true });

  if (error) {
    throw new Error("Failed to load people");
  }

  const people = (data ?? []) as (PersonRow & {
    food_preferences: { count: number }[];
    person_preferences: { count: number }[];
  })[];

  return (
    <Screen>
      <ScreenHeader title="People" description="Everyone MeOS remembers for you." />
      <CategoryRail />

      {/* Renders nothing where the OS picker doesn't exist, which is
          everywhere but Chrome on Android. */}
      <ImportContactsButton existingNames={people.map((person) => person.name)} />

      {people.length === 0 ? (
        <Empty
          icon={Users}
          title="No people yet"
          description='Tap + and say something like "My sister Dana loves jazz and her birthday is 3 March."'
        />
      ) : (
        <List>
          {people.map((person) => {
            const preferenceCount =
              (person.food_preferences[0]?.count ?? 0) +
              (person.person_preferences[0]?.count ?? 0);

            const details = [
              person.relationship,
              person.birthday
                ? `🎂 ${formatEventDate(person.birthday, person.birthday_year_known)}`
                : null,
              preferenceCount > 0
                ? `${preferenceCount} ${preferenceCount === 1 ? "preference" : "preferences"}`
                : null,
            ].filter(Boolean);

            return (
              <ListRow
                key={person.id}
                href={`/people/${person.id}`}
                leading={
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-cat-person/10 text-sm font-semibold text-cat-person">
                    {initials(person.name)}
                  </span>
                }
                title={person.name}
                subtitle={details.length > 0 ? details.join(" · ") : undefined}
              />
            );
          })}
        </List>
      )}
    </Screen>
  );
}
