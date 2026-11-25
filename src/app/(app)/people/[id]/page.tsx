import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  CalendarHeart,
  Gift,
  Heart,
  Package,
  ShoppingCart,
  ThumbsDown,
  UtensilsCrossed,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  daysUntil,
  daysUntilLabel,
  formatEventDate,
  nextOccurrence,
  upcomingAge,
} from "@/lib/dates";
import { initials } from "@/lib/initials";
import type {
  FoodPreferenceRow,
  ImportantDateRow,
  PersonPreferenceRow,
  PersonRow,
} from "@/lib/types";
import { Screen, ScreenHeader } from "@/components/kit/screen";
import { Section } from "@/components/kit/section";
import { List, ListRow } from "@/components/kit/list";
import { DeleteRecordButton } from "@/components/delete-record-button";

export const metadata: Metadata = { title: "Person" };

const FOOD_TYPE_LABEL: Record<FoodPreferenceRow["preference_type"], string> = {
  like: "Likes",
  dislike: "Dislikes",
  allergy: "Allergy",
  dietary_restriction: "Dietary",
};

export default async function PersonPage(props: PageProps<"/people/[id]">) {
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: person } = await supabase
    .from("people")
    .select("id, name, relationship, birthday, birthday_year_known, notes, created_at")
    .eq("id", id)
    .maybeSingle<PersonRow>();

  if (!person) {
    notFound();
  }

  /*
   * The hub queries: everything MeOS knows about this person, wherever it
   * lives. Gift ideas, loans and sizes reference people by *name* — they were
   * captured as free speech, not foreign keys — so matching is by name, made
   * safe for a filter pattern by stripping the characters PostgREST parses.
   */
  const cleanedName = person.name.replace(/[%_,()]/g, "").trim();
  /*
   * A name that strips to nothing (or to a fragment) must not become '%%',
   * which matches every row (review finding). Under three characters the
   * substring match also drowns in false positives — "Al" is inside
   * "calendar" — so name-matched sections simply don't run for such names.
   */
  const nameMatchable = cleanedName.length >= 3;
  const namePattern = `%${cleanedName}%`;
  const nothing = Promise.resolve({ data: [] });

  const [
    { data: foodPrefs },
    { data: generalPrefs },
    { data: dates },
    { data: giftNotes },
    { data: loanRows },
    { data: sizeRows },
  ] = await Promise.all([
    supabase
      .from("food_preferences")
      .select("id, food_name, preference_type, severity, notes")
      .eq("person_id", id)
      .order("preference_type"),
    supabase
      .from("person_preferences")
      .select("id, preference_type, value, notes")
      .eq("person_id", id),
    supabase
      .from("important_dates")
      .select("id, title, event_date, year_known, recurrence")
      .eq("person_id", id),
    nameMatchable
      ? supabase
          .from("notes")
          .select("id, title, content")
          .eq("note_type", "gift_idea")
          .or(`title.ilike.${namePattern},content.ilike.${namePattern}`)
          .limit(10)
      : nothing,
    nameMatchable
      ? supabase
          .from("items")
          .select("id, title, attributes, created_at")
          .eq("type_key", "loan")
          .eq("status", "active")
          .ilike("attributes->>who", namePattern)
          .limit(10)
      : nothing,
    nameMatchable
      ? supabase
          .from("items")
          .select("id, title, attributes")
          .eq("type_key", "size")
          .ilike("attributes->>person", namePattern)
          .limit(10)
      : nothing,
  ]);

  const food = (foodPrefs ?? []) as Pick<
    FoodPreferenceRow,
    "id" | "food_name" | "preference_type" | "severity" | "notes"
  >[];
  const general = (generalPrefs ?? []) as Pick<
    PersonPreferenceRow,
    "id" | "preference_type" | "value" | "notes"
  >[];
  const personDates = (dates ?? []) as Pick<
    ImportantDateRow,
    "id" | "title" | "event_date" | "year_known" | "recurrence"
  >[];

  const allergies = food.filter((f) => f.preference_type === "allergy");
  const otherFood = food.filter((f) => f.preference_type !== "allergy");
  const gifts = (giftNotes ?? []) as { id: string; title: string | null; content: string }[];
  const loans = (loanRows ?? []) as {
    id: string;
    title: string;
    attributes: Record<string, string>;
  }[];
  const sizes = (sizeRows ?? []) as {
    id: string;
    title: string;
    attributes: Record<string, string>;
  }[];
  const age = person.birthday ? upcomingAge(person.birthday, person.birthday_year_known) : null;

  const subtitle = [
    person.relationship,
    person.birthday
      ? `🎂 ${formatEventDate(person.birthday, person.birthday_year_known)}${
          age !== null ? ` · turning ${age}` : ""
        }`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Screen>
      <ScreenHeader
        backHref="/people"
        backLabel="People"
        title={person.name}
        description={subtitle || undefined}
        action={
          <DeleteRecordButton
            table="people"
            id={person.id}
            label={person.name}
            redirectTo="/people"
          />
        }
      />

      <div className="flex justify-center">
        <span
          aria-hidden
          className="flex size-20 items-center justify-center rounded-full bg-cat-person/10 font-display text-3xl text-cat-person"
        >
          {initials(person.name)}
        </span>
      </div>

      {/* Allergies come first and stay first — they're the one thing on this
          screen that can matter urgently. */}
      {allergies.length > 0 && (
        <Section title="Allergies">
          <List>
            {allergies.map((allergy) => (
              <ListRow
                key={allergy.id}
                icon={AlertTriangle}
                iconClassName="bg-destructive/10 text-destructive"
                title={allergy.food_name}
                subtitle={allergy.severity ?? allergy.notes ?? undefined}
              />
            ))}
          </List>
          <p className="px-1 text-xs text-muted-foreground">
            Your own record — always double-check. This isn&apos;t medical advice.
          </p>
        </Section>
      )}

      {person.notes && (
        <Section title="Notes">
          <p className="whitespace-pre-wrap rounded-lg bg-card p-4 text-base shadow-card">
            {person.notes}
          </p>
        </Section>
      )}

      {general.length > 0 && (
        <Section title="Preferences">
          <List>
            {general.map((pref) => (
              <ListRow
                key={pref.id}
                icon={pref.preference_type === "like" ? Heart : ThumbsDown}
                iconClassName={
                  pref.preference_type === "like"
                    ? "bg-cat-person/10 text-cat-person"
                    : "bg-secondary text-muted-foreground"
                }
                title={pref.value}
                subtitle={pref.preference_type === "like" ? "Likes" : "Dislikes"}
              />
            ))}
          </List>
        </Section>
      )}

      {otherFood.length > 0 && (
        <Section title="Food">
          <List>
            {otherFood.map((pref) => (
              <ListRow
                key={pref.id}
                icon={UtensilsCrossed}
                iconClassName="bg-cat-food/10 text-cat-food"
                title={pref.food_name}
                subtitle={FOOD_TYPE_LABEL[pref.preference_type]}
              />
            ))}
          </List>
        </Section>
      )}

      {personDates.length > 0 && (
        <Section title="Dates">
          <List>
            {personDates.map((date) => {
              const next = nextOccurrence(date.event_date, date.recurrence);
              return (
                <ListRow
                  key={date.id}
                  icon={CalendarHeart}
                  iconClassName="bg-cat-date/10 text-cat-date"
                  title={date.title}
                  subtitle={`${formatEventDate(date.event_date, date.year_known)}${
                    date.recurrence === "yearly" ? " · every year" : ""
                  }`}
                  trailing={
                    next && (
                      <span
                        data-numeric
                        className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground whitespace-nowrap"
                      >
                        {daysUntilLabel(daysUntil(next))}
                      </span>
                    )
                  }
                />
              );
            })}
          </List>
        </Section>
      )}

      {gifts.length > 0 && (
        <Section title="Gift ideas" href="/notes">
          <List>
            {gifts.map((note) => (
              <ListRow
                key={note.id}
                icon={Gift}
                iconClassName="bg-cat-note/10 text-cat-note"
                title={note.title ?? note.content.slice(0, 80)}
                subtitle={note.title ? note.content.slice(0, 80) : undefined}
              />
            ))}
          </List>
        </Section>
      )}

      {loans.length > 0 && (
        <Section title="Between you two">
          <List>
            {loans.map((loan) => (
              <ListRow
                key={loan.id}
                icon={Package}
                iconClassName="bg-warning/10 text-warning"
                title={loan.title}
                subtitle={
                  loan.attributes.direction === "borrowed"
                    ? `You borrowed this from ${person.name}`
                    : `${person.name} still has this`
                }
              />
            ))}
          </List>
        </Section>
      )}

      {sizes.length > 0 && (
        <Section title="Sizes">
          <List>
            {sizes.map((size) => (
              <ListRow
                key={size.id}
                icon={ShoppingCart}
                iconClassName="bg-cat-person/10 text-cat-person"
                title={size.title}
                subtitle={size.attributes.kind}
                trailing={
                  size.attributes.value && (
                    <span
                      data-numeric
                      className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground whitespace-nowrap"
                    >
                      {size.attributes.value}
                    </span>
                  )
                }
              />
            ))}
          </List>
        </Section>
      )}

      {allergies.length === 0 &&
        general.length === 0 &&
        otherFood.length === 0 &&
        personDates.length === 0 &&
        gifts.length === 0 &&
        loans.length === 0 &&
        sizes.length === 0 &&
        !person.notes && (
          <p className="rounded-lg bg-card px-6 py-10 text-center text-base text-muted-foreground shadow-card">
            Nothing saved about {person.name} yet. Tap + and tell MeOS something.
          </p>
        )}
    </Screen>
  );
}
