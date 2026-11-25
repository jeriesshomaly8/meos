import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { chipClassForType, iconForType } from "@/lib/items/icons";
import { asItemRows, dueLabel, ITEM_SELECT } from "@/lib/items/rows";
import { TYPE_KEY_PATTERN } from "@/lib/items/types";
import { Screen, ScreenHeader } from "@/components/kit/screen";
import { List, ListRow } from "@/components/kit/list";
import { Empty } from "@/components/kit/empty";

const PER_TYPE_LIMIT = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<Metadata> {
  const { key } = await params;
  return { title: key.replace(/_/g, " ") };
}

/**
 * Everything filed under one type.
 *
 * Works for core and custom types alike — a custom type is a row in the same
 * registry, so it needs no screen of its own. The attributes a record carries
 * are rendered generically from the JSON, which is what the shallow shape in
 * §2.3 was for: no nested objects means every value can always be printed.
 */
export default async function TypePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  // The key reaches Postgres in a filter, so it is checked against the same
  // pattern the column enforces before it is used at all.
  if (!TYPE_KEY_PATTERN.test(key)) notFound();

  const supabase = await createClient();
  const [{ data: profile }, { data: typeRow }, { data: rows }] = await Promise.all([
    supabase.from("profiles").select("timezone").limit(1).maybeSingle(),
    supabase
      .from("item_types")
      .select("key, singular, plural, icon, color, kind")
      .eq("key", key)
      .maybeSingle(),
    supabase
      .from("items")
      .select(ITEM_SELECT)
      .eq("type_key", key)
      .order("created_at", { ascending: false })
      .limit(PER_TYPE_LIMIT),
  ]);

  if (!typeRow) notFound();
  const type = typeRow as {
    key: string;
    singular: string;
    plural: string;
    icon: string;
    color: string;
  };

  const timeZone = (profile?.timezone as string | null) ?? "UTC";
  const now = new Date();
  const items = asItemRows(rows);

  return (
    <Screen>
      <ScreenHeader
        title={type.plural}
        description={`Everything you've saved as ${type.singular.toLowerCase()}.`}
      />

      {items.length === 0 ? (
        <Empty
          icon={iconForType(type.icon)}
          title={`No ${type.plural.toLowerCase()} yet`}
          description={`Tell MeOS about ${type.singular.toLowerCase() === type.plural.toLowerCase() ? "one" : `a ${type.singular.toLowerCase()}`} and it will be filed here.`}
        />
      ) : (
        <List>
          {items.map((row) => {
            const when = dueLabel(row.due_at, row.all_day, now, timeZone);
            /*
             * The summary if there is one, otherwise the attributes read back
             * as "location: living room" — which is what the user actually
             * said, and better than repeating the type name at them (§1.8).
             */
            const subtitle =
              row.summary ??
              [when].filter(Boolean).join(" · ") ??
              "";
            return (
              <ListRow
                key={row.id}
                icon={iconForType(type.icon)}
                iconClassName={chipClassForType(type.color)}
                title={row.title}
                subtitle={row.status === "done" ? `Done${subtitle ? ` · ${subtitle}` : ""}` : subtitle}
                href={row.capability === "alarm" ? `/alarm/${row.id}` : undefined}
              />
            );
          })}
        </List>
      )}
    </Screen>
  );
}
