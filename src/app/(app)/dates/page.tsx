import type { Metadata } from "next";
import { format } from "date-fns";
import { CalendarDays, Repeat } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { daysUntil, daysUntilLabel, formatEventDate, nextOccurrence } from "@/lib/dates";
import type { DocumentRow, ImportantDateRow, ReminderRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Screen, ScreenHeader } from "@/components/kit/screen";
import { CategoryRail } from "@/components/kit/category-rail";
import { Section } from "@/components/kit/section";
import { List, ListRow } from "@/components/kit/list";
import { Empty } from "@/components/kit/empty";
import { DeleteRecordButton } from "@/components/delete-record-button";
import { ReminderItem } from "@/components/reminder-item";

export const metadata: Metadata = { title: "Dates" };

const URGENT_DAYS = 7;

type DateWithPerson = Pick<
  ImportantDateRow,
  "id" | "title" | "event_date" | "year_known" | "recurrence"
> & { people: { name: string } | null };

export default async function DatesPage() {
  const supabase = await createClient();

  const [{ data: dates }, { data: reminders }, { data: documents }] = await Promise.all([
    supabase
      .from("important_dates")
      .select("id, title, event_date, year_known, recurrence, people(name)")
      .limit(200),
    supabase
      .from("reminders")
      .select("id, title, remind_at, completed, related_entity_type, related_entity_id")
      .order("remind_at", { ascending: true })
      .limit(100),
    supabase.from("documents").select("id, display_name"),
  ]);

  const allReminders = (reminders ?? []) as Pick<
    ReminderRow,
    "id" | "title" | "remind_at" | "completed" | "related_entity_type" | "related_entity_id"
  >[];
  const documentNames = new Map(
    ((documents ?? []) as Pick<DocumentRow, "id" | "display_name">[]).map((d) => [
      d.id,
      d.display_name,
    ]),
  );

  const today = new Date();
  const upcoming = ((dates ?? []) as unknown as DateWithPerson[])
    .map((row) => ({ row, next: nextOccurrence(row.event_date, row.recurrence, today) }))
    .filter((entry): entry is { row: DateWithPerson; next: Date } => entry.next !== null)
    .sort((a, b) => a.next.getTime() - b.next.getTime());

  const past = ((dates ?? []) as unknown as DateWithPerson[]).filter(
    (row) => nextOccurrence(row.event_date, row.recurrence, today) === null,
  );

  const byMonth = new Map<string, typeof upcoming>();
  for (const entry of upcoming) {
    const key = format(entry.next, "MMMM yyyy");
    byMonth.set(key, [...(byMonth.get(key) ?? []), entry]);
  }

  const openReminders = allReminders.filter((r) => !r.completed);
  const doneReminders = allReminders.filter((r) => r.completed);

  return (
    <Screen>
      <ScreenHeader title="Dates" description="Birthdays, anniversaries and reminders." />
      <CategoryRail />

      {upcoming.length === 0 && past.length === 0 && allReminders.length === 0 ? (
        <Empty
          icon={CalendarDays}
          title="Nothing on the calendar"
          description='Try "Our anniversary is 8 June" or "Remind me to renew the car insurance in October."'
        />
      ) : (
        <>
          {[...byMonth.entries()].map(([month, entries]) => (
            <Section key={month} title={month}>
              <List>
                {entries.map(({ row, next }) => {
                  const days = daysUntil(next, today);
                  return (
                    <ListRow
                      key={row.id}
                      leading={
                        // Calendar tile instead of a category icon: on a dates
                        // screen the day number IS the identity of the row.
                        <span className="flex size-10 shrink-0 flex-col items-center justify-center rounded-md bg-cat-date/10 text-cat-date">
                          <span data-numeric className="text-base font-semibold leading-none">
                            {format(next, "d")}
                          </span>
                          <span className="text-[0.625rem] uppercase leading-tight">
                            {format(next, "EEE")}
                          </span>
                        </span>
                      }
                      title={
                        <span className="flex items-center gap-1.5">
                          {row.title}
                          {row.recurrence === "yearly" && (
                            <Repeat
                              className="size-3.5 shrink-0 text-muted-foreground"
                              aria-label="Repeats every year"
                            />
                          )}
                        </span>
                      }
                      subtitle={[
                        formatEventDate(row.event_date, row.year_known),
                        row.people?.name,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      trailing={
                        <span className="flex items-center gap-1">
                          <span
                            data-numeric
                            className={cn(
                              "rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
                              days <= URGENT_DAYS
                                ? "bg-primary/12 text-primary"
                                : "bg-secondary text-muted-foreground",
                            )}
                          >
                            {daysUntilLabel(days)}
                          </span>
                          <DeleteRecordButton
                            table="important_dates"
                            id={row.id}
                            label={`“${row.title}”`}
                          />
                        </span>
                      }
                    />
                  );
                })}
              </List>
            </Section>
          ))}

          {past.length > 0 && (
            <p className="px-1 text-xs text-muted-foreground">
              {past.length} past one-off {past.length === 1 ? "date is" : "dates are"} still kept in
              your memory.
            </p>
          )}

          <Section title="Reminders" className="scroll-mt-4" >
            <div id="reminders">
              {allReminders.length === 0 ? (
                <p className="rounded-lg bg-card px-6 py-8 text-center text-base text-muted-foreground shadow-card">
                  No reminders yet. Tap + and say “remind me to renew my passport six months before
                  it expires.”
                </p>
              ) : (
                <List>
                  {[...openReminders, ...doneReminders].map((reminder) => (
                    <ReminderItem
                      key={reminder.id}
                      id={reminder.id}
                      title={reminder.title}
                      remindAt={reminder.remind_at}
                      completed={reminder.completed}
                      relatedLabel={
                        reminder.related_entity_type === "document" && reminder.related_entity_id
                          ? (documentNames.get(reminder.related_entity_id) ?? null)
                          : null
                      }
                    />
                  ))}
                </List>
              )}
            </div>
          </Section>
        </>
      )}
    </Screen>
  );
}
