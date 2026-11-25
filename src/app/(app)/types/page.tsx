import type { Metadata } from "next";
import { Shapes } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { chipClassForType, iconForType } from "@/lib/items/icons";
import { Screen, ScreenHeader } from "@/components/kit/screen";
import { Section } from "@/components/kit/section";
import { List, ListRow } from "@/components/kit/list";
import { Empty } from "@/components/kit/empty";

export const metadata: Metadata = { title: "Types" };

/**
 * Every type MeOS knows, with how much is filed under each.
 *
 * §1.7 said `CategoryRail` cannot grow past about eight chips, and custom types
 * mean the list is now open-ended — so the rail keeps a fixed set and overflows
 * to here rather than growing until it is unusable. This is also the only place
 * a user can see a type they approved but has not filed anything under since.
 */
export default async function TypesPage() {
  const supabase = await createClient();

  const [{ data: typeRows }, { data: itemRows }] = await Promise.all([
    supabase
      .from("item_types")
      .select("key, singular, plural, icon, color, kind, hidden, merged_into")
      .order("kind", { ascending: true })
      .order("plural", { ascending: true }),
    // One bounded read and a count in TypeScript: a personal memory has
    // hundreds of rows, and a count-per-type would be one query per type.
    supabase.from("items").select("type_key").limit(2000),
  ]);

  const counts = new Map<string, number>();
  for (const row of (itemRows ?? []) as { type_key: string }[]) {
    counts.set(row.type_key, (counts.get(row.type_key) ?? 0) + 1);
  }

  const types = ((typeRows ?? []) as {
    key: string;
    singular: string;
    plural: string;
    icon: string;
    color: string;
    kind: "core" | "custom";
    hidden: boolean | null;
    merged_into: string | null;
  }[]).filter((type) => !type.hidden && !type.merged_into);

  const custom = types.filter((type) => type.kind === "custom");
  /*
   * Core types with nothing in them are noise — they exist for everyone whether
   * or not this user has used them. A *custom* type with nothing in it is worth
   * showing: the user approved it, and its absence would look like it failed.
   */
  const core = types.filter((type) => type.kind === "core" && (counts.get(type.key) ?? 0) > 0);

  function rows(list: typeof types) {
    return list.map((type) => {
      const n = counts.get(type.key) ?? 0;
      return (
        <ListRow
          key={type.key}
          icon={iconForType(type.icon)}
          iconClassName={chipClassForType(type.color)}
          title={type.plural}
          subtitle={n === 0 ? "Nothing filed yet" : n === 1 ? `1 ${type.singular.toLowerCase()}` : `${n} ${type.plural.toLowerCase()}`}
          href={`/types/${type.key}`}
        />
      );
    });
  }

  return (
    <Screen>
      <ScreenHeader
        title="Types"
        description="Every kind of thing MeOS is keeping for you."
      />

      {core.length === 0 && custom.length === 0 ? (
        <Empty
          icon={Shapes}
          title="Nothing filed yet"
          description="Save something and the type it lands under will appear here."
        />
      ) : (
        <>
          {custom.length > 0 && (
            <Section title="Yours">
              <List>{rows(custom)}</List>
            </Section>
          )}
          {core.length > 0 && (
            <Section title="Built in">
              <List>{rows(core)}</List>
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}
