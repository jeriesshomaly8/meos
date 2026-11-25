import type { Metadata } from "next";
import { CircleCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { asItemRows, groupByDue, ITEM_SELECT, toActionableItem } from "@/lib/items/rows";
import { Screen, ScreenHeader } from "@/components/kit/screen";
import { CategoryRail } from "@/components/kit/category-rail";
import { Section } from "@/components/kit/section";
import { List } from "@/components/kit/list";
import { Empty } from "@/components/kit/empty";
import { ActionableRow } from "@/components/today/actionable-row";

export const metadata: Metadata = { title: "Tasks" };

/** Finished work is worth seeing, but not worth scrolling past. */
const DONE_LIMIT = 10;
const ACTIVE_LIMIT = 200;

/**
 * Every task, not just the ones due by tonight.
 *
 * Today answers "what is due by the end of today?", which means a task saved
 * with no date has never appeared anywhere since Phase 3 shipped — saved, then
 * invisible. The "Someday" section below is the whole reason this screen
 * exists; the rest is the same rows Today already renders.
 */
export default async function TasksPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: profile }, { data: activeRows }, { data: doneRows }] = await Promise.all([
    supabase.from("profiles").select("timezone").eq("id", user!.id).maybeSingle(),
    supabase
      .from("items")
      .select(ITEM_SELECT)
      .in("capability", ["task", "alarm"])
      .eq("status", "active")
      // Nulls last, so undated work sits under the dated work rather than above it.
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(ACTIVE_LIMIT),
    supabase
      .from("items")
      .select(ITEM_SELECT)
      .in("capability", ["task", "alarm"])
      .eq("status", "done")
      .order("completed_at", { ascending: false })
      .limit(DONE_LIMIT),
  ]);

  const now = new Date();
  const timeZone = (profile?.timezone as string | null) ?? "UTC";

  const active = asItemRows(activeRows);
  const tasks = active.filter((row) => row.capability === "task");
  const alarms = active.filter((row) => row.capability === "alarm");

  const { overdue, today, upcoming, undated } = groupByDue(tasks, now, timeZone);
  const done = asItemRows(doneRows).map((row) => toActionableItem(row, now, timeZone));

  const nothingAtAll =
    active.length === 0 && done.length === 0;

  return (
    <Screen>
      <ScreenHeader title="Tasks" description="Everything you've said you'd do." />
      <CategoryRail />

      {nothingAtAll ? (
        <Empty
          icon={CircleCheck}
          title="Nothing on your list"
          description="Tell MeOS something you need to do — “buy milk tomorrow”, “renew the car insurance” — and it lands here."
        />
      ) : (
        <>
          {/* Overdue first and the only red thing on the screen, as on Today. */}
          {overdue.length > 0 && (
            <Section title={overdue.length === 1 ? "Overdue" : `Overdue · ${overdue.length}`}>
              <List>
                {overdue.map((item) => (
                  <ActionableRow key={item.id} item={item} />
                ))}
              </List>
            </Section>
          )}

          {today.length > 0 && (
            <Section title="Today">
              <List>
                {today.map((item) => (
                  <ActionableRow key={item.id} item={item} />
                ))}
              </List>
            </Section>
          )}

          {upcoming.length > 0 && (
            <Section title="Later">
              <List>
                {upcoming.map((item) => (
                  <ActionableRow key={item.id} item={item} />
                ))}
              </List>
            </Section>
          )}

          {/*
            Named for what it means rather than for the missing field. "No due
            date" describes the database; "Someday" describes the intention,
            which is what the user had when they said it.
          */}
          {undated.length > 0 && (
            <Section title="Someday">
              <List>
                {undated.map((item) => (
                  <ActionableRow key={item.id} item={item} />
                ))}
              </List>
            </Section>
          )}

          {/*
            Alarms sit apart from the due groups because they are not work to
            get through — they are something that happens to you, and ticking
            one means silencing it rather than finishing it.
          */}
          {alarms.length > 0 && (
            <Section title="Alarms set">
              <List>
                {alarms.map((row) => (
                  <ActionableRow key={row.id} item={toActionableItem(row, now, timeZone)} />
                ))}
              </List>
            </Section>
          )}

          {done.length > 0 && (
            <Section title="Recently done">
              <List>
                {done.map((item) => (
                  <ActionableRow key={item.id} item={item} />
                ))}
              </List>
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}
