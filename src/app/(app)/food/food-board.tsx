"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Heart, Leaf, ThumbsDown } from "lucide-react";
import type { AllergySeverity, FoodPreferenceType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { List, ListRow } from "@/components/kit/list";
import { Section } from "@/components/kit/section";
import { DeleteRecordButton } from "@/components/delete-record-button";

export interface FoodEntry {
  id: string;
  foodName: string;
  preferenceType: FoodPreferenceType;
  severity: AllergySeverity | null;
  notes: string | null;
  personName: string | null;
}

const EVERYONE = "__everyone__";
const ME = "__me__";

/** Allergies first — they're the entries with real-world consequences. */
const SECTIONS: {
  type: FoodPreferenceType;
  title: string;
  icon: typeof Heart;
  chipClass: string;
}[] = [
  {
    type: "allergy",
    title: "Allergies",
    icon: AlertTriangle,
    chipClass: "bg-destructive/10 text-destructive",
  },
  {
    type: "dietary_restriction",
    title: "Dietary",
    icon: Leaf,
    chipClass: "bg-cat-food/10 text-cat-food",
  },
  { type: "like", title: "Likes", icon: Heart, chipClass: "bg-cat-person/10 text-cat-person" },
  {
    type: "dislike",
    title: "Dislikes",
    icon: ThumbsDown,
    chipClass: "bg-secondary text-muted-foreground",
  },
];

export function FoodBoard({ entries }: { entries: FoodEntry[] }) {
  const [person, setPerson] = useState(EVERYONE);

  const peopleNames = useMemo(
    () =>
      [...new Set(entries.map((e) => e.personName).filter((n): n is string => n !== null))].sort(),
    [entries],
  );

  const filtered = entries.filter((entry) => {
    if (person === EVERYONE) return true;
    if (person === ME) return entry.personName === null;
    return entry.personName === person;
  });

  /*
   * A dropdown was hiding the most useful control on the screen behind a tap.
   * With a handful of people, chips show every option at once and switching
   * costs one tap instead of three.
   */
  const filters = [
    { value: EVERYONE, label: "Everyone" },
    { value: ME, label: "Just me" },
    ...peopleNames.map((name) => ({ value: name, label: name })),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div role="group" aria-label="Filter by person" className="rail -mx-4 gap-2 px-4 py-0.5">
        {filters.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => setPerson(filter.value)}
            aria-pressed={person === filter.value}
            className={cn(
              "flex h-9 items-center rounded-full px-4 text-base font-medium transition-colors duration-150",
              person === filter.value
                ? "bg-foreground text-background"
                : "bg-card text-muted-foreground shadow-card active:bg-secondary",
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg bg-card px-6 py-10 text-center text-base text-muted-foreground shadow-card">
          Nothing saved for this person yet.
        </p>
      ) : (
        SECTIONS.map(({ type, title, icon: Icon, chipClass }) => {
          const sectionEntries = filtered.filter((entry) => entry.preferenceType === type);
          if (sectionEntries.length === 0) return null;

          return (
            <Section key={type} title={title}>
              <List>
                {sectionEntries.map((entry) => (
                  <ListRow
                    key={entry.id}
                    icon={Icon}
                    iconClassName={chipClass}
                    title={
                      <span className="flex items-center gap-2">
                        {entry.foodName}
                        {entry.severity && (
                          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-2xs font-medium uppercase tracking-wide text-destructive">
                            {entry.severity}
                          </span>
                        )}
                      </span>
                    }
                    subtitle={[entry.personName ?? "You", entry.notes].filter(Boolean).join(" · ")}
                    trailing={
                      <DeleteRecordButton
                        table="food_preferences"
                        id={entry.id}
                        label={`"${entry.foodName}"`}
                      />
                    }
                  />
                ))}
              </List>
              {type === "allergy" && (
                <p className="px-1 text-xs text-muted-foreground">
                  Your own records, not medical advice — always double-check when it matters.
                </p>
              )}
            </Section>
          );
        })
      )}
    </div>
  );
}
