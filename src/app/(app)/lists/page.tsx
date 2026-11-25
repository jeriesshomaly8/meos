import type { Metadata } from "next";
import { ListChecks } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { asItemRows, ITEM_SELECT, listProgress, toActionableItem } from "@/lib/items/rows";
import { Screen, ScreenHeader } from "@/components/kit/screen";
import { CategoryRail } from "@/components/kit/category-rail";
import { Section } from "@/components/kit/section";
import { List } from "@/components/kit/list";
import { Empty } from "@/components/kit/empty";
import { ActionableRow } from "@/components/today/actionable-row";

export const metadata: Metadata = { title: "Lists" };

const DONE_LIMIT = 10;
const ACTIVE_LIMIT = 100;

/**
 * Lists, whether or not they are due today.
 *
 * Same gap as tasks: a shopping list saved without a day never reached Today,
 * so the rows existed and nothing rendered them. Sorted by how much is left
 * rather than by date — the useful question about a list is "is there anything
 * still on it?", and a half-ticked list matters more than an untouched one
 * saved yesterday.
 */
export default async function ListsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: profile }, { data: activeRows }, { data: doneRows }] = await Promise.all([
    supabase.from("profiles").select("timezone").eq("id", user!.id).maybeSingle(),
    supabase
      .from("items")
      .select(ITEM_SELECT)
      .eq("capability", "list")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(ACTIVE_LIMIT),
    supabase
      .from("items")
      .select(ITEM_SELECT)
      .eq("capability", "list")
      .eq("status", "done")
      .order("completed_at", { ascending: false })
      .limit(DONE_LIMIT),
  ]);

  const now = new Date();
  const timeZone = (profile?.timezone as string | null) ?? "UTC";

  const active = asItemRows(activeRows);
  const unfinished = active.filter((row) => {
    const { checked, total } = listProgress(row);
    return total === 0 || checked < total;
  });
  /*
   * Every line ticked but the list itself never marked done. It is finished in
   * every sense the user cares about, so it drops below the live ones instead
   * of sitting at the top looking like outstanding work.
   */
  const allTicked = active.filter((row) => {
    const { checked, total } = listProgress(row);
    return total > 0 && checked === total;
  });

  const done = asItemRows(doneRows);

  return (
    <Screen>
      <ScreenHeader title="Lists" description="Things to tick off, one line at a time." />
      <CategoryRail />

      {active.length === 0 && done.length === 0 ? (
        <Empty
          icon={ListChecks}
          title="No lists yet"
          description="Say “shopping list for tomorrow: milk, bread and eggs” and MeOS will make each one its own line to tick."
        />
      ) : (
        <>
          {unfinished.length > 0 && (
            <Section title="In progress">
              <List>
                {unfinished.map((row) => (
                  <ActionableRow key={row.id} item={toActionableItem(row, now, timeZone)} />
                ))}
              </List>
            </Section>
          )}

          {allTicked.length > 0 && (
            <Section title="Everything ticked">
              <List>
                {allTicked.map((row) => (
                  <ActionableRow key={row.id} item={toActionableItem(row, now, timeZone)} />
                ))}
              </List>
            </Section>
          )}

          {done.length > 0 && (
            <Section title="Recently finished">
              <List>
                {done.map((row) => (
                  <ActionableRow key={row.id} item={toActionableItem(row, now, timeZone)} />
                ))}
              </List>
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}
