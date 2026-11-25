import { formatDistanceToNow } from "date-fns";
import { Mic, Sparkles } from "lucide-react";
import { SHARED_ENTRY_PARAM, SHARED_TEXT_PARAM } from "@/lib/share/shared-text";
import { createClient } from "@/lib/supabase/server";
import { CATEGORY_META, type ExtractionCategory } from "@/lib/categories";
import {
  daysUntil,
  daysUntilLabel,
  expiryStatus,
  formatEventDate,
  nextOccurrence,
  parseDateOnly,
} from "@/lib/dates";
import type {
  DocumentRow,
  ImportantDateRow,
  NoteRow,
  PersonRow,
  RecipeRow,
  ReminderRow,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { endOfDayInZone, isoDateInZone, partsInZone, startOfDayInZone } from "@/lib/temporal/zone";
import { asItemRows, dueLabel, groupByDue, ITEM_SELECT } from "@/lib/items/rows";
import { Screen, ScreenHeader } from "@/components/kit/screen";
import { Section } from "@/components/kit/section";
import { List, ListRow } from "@/components/kit/list";
import { Empty } from "@/components/kit/empty";
import { ActionableRow } from "@/components/today/actionable-row";

/** How many rows the two Today lists show before deferring to their screens. */
const UPCOMING_LIMIT = 6;
const RECENT_LIMIT = 5;
/** Inside this window an item is styled as urgent rather than informational. */
const URGENT_DAYS = 7;

function greeting(hour: number): string {
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

interface UpcomingEntry {
  key: string;
  category: ExtractionCategory;
  title: string;
  subtitle: string;
  when: Date;
  href: string;
  overdue?: boolean;
}

function Countdown({ when, overdue }: { when: Date; overdue?: boolean }) {
  const days = daysUntil(when, new Date());
  return (
    <span
      data-numeric
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        overdue
          ? "bg-destructive/10 text-destructive"
          : days <= URGENT_DAYS
            ? "bg-primary/12 text-primary"
            : "bg-secondary text-muted-foreground",
      )}
    >
      {overdue ? "Expired" : daysUntilLabel(days)}
    </span>
  );
}

export default async function TodayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    { data: profile },
    { data: dates },
    { data: reminders },
    { data: documents },
    { data: recentPeople },
    { data: recentNotes },
    { data: recentRecipes },
  ] = await Promise.all([
    supabase.from("profiles").select("display_name, timezone").eq("id", user!.id).maybeSingle(),
    supabase
      .from("important_dates")
      .select("id, title, event_date, year_known, recurrence, person_id")
      .limit(100),
    supabase
      .from("reminders")
      .select("id, title, remind_at, completed")
      .eq("completed", false)
      .order("remind_at", { ascending: true })
      .limit(UPCOMING_LIMIT),
    supabase
      .from("documents")
      .select("id, display_name, expiration_date")
      .not("expiration_date", "is", null)
      .order("expiration_date", { ascending: true })
      .limit(UPCOMING_LIMIT),
    supabase
      .from("people")
      .select("id, name, created_at")
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT),
    supabase
      .from("notes")
      .select("id, title, content, created_at")
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT),
    supabase
      .from("recipes")
      .select("id, name, created_at")
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT),
  ]);

  const displayName =
    (profile?.display_name as string | null) ?? user?.email?.split("@")[0] ?? "there";

  const today = new Date();
  /*
   * Every day boundary below is computed in the user's zone, not the server's.
   * On a UTC host this is the difference between "due today" being right and
   * being wrong for the last three hours of a Jerusalem evening.
   */
  const timeZone = (profile?.timezone as string | null) ?? "UTC";
  /*
   * The user's calendar day, as a Date the date-fns helpers can consume.
   * Passing raw `today` gave them the SERVER's day — wrong every Jerusalem
   * evening on a UTC host, in the exact file whose comments promise otherwise
   * (review finding).
   */
  const todayInZone = parseDateOnly(isoDateInZone(today, timeZone)) ?? today;

  // Anything actionable that is due by the end of the user's today, including
  // whatever is already overdue. Ordering puts the oldest overdue item first.
  const { data: actionableRows } = await supabase
    .from("items")
    .select(ITEM_SELECT)
    .in("capability", ["task", "list", "alarm"])
    .eq("status", "active")
    .not("due_at", "is", null)
    .lte("due_at", endOfDayInZone(today, timeZone).toISOString())
    .order("due_at", { ascending: true })
    .limit(20);

  const { overdue, today: dueToday } = groupByDue(asItemRows(actionableRows), today, timeZone);
  const actionable = [...overdue, ...dueToday];

  /*
   * Events are queried apart from the actionable rows because their clock runs
   * the other way: a task from yesterday is overdue and belongs on this
   * screen, an event from yesterday is simply over and does not. The window
   * starts at the user's midnight, so nothing past ever surfaces.
   */
  const { data: eventRows } = await supabase
    .from("items")
    .select(ITEM_SELECT)
    .eq("capability", "event")
    .eq("status", "active")
    .not("starts_at", "is", null)
    .gte("starts_at", startOfDayInZone(today, timeZone).toISOString())
    .order("starts_at", { ascending: true })
    .limit(12);

  const events = asItemRows(eventRows);
  const endOfToday = endOfDayInZone(today, timeZone).toISOString();
  const happeningToday = events.filter((row) => row.starts_at! <= endOfToday);
  const upcomingEvents = events.filter((row) => row.starts_at! > endOfToday);

  // Captures that arrived from outside — Siri, with the phone in a pocket —
  // and wait for review. Shown before everything else: text captured and
  // then invisible is the failure mode this screen exists to prevent.
  // Waiting means "not yet confirmed or discarded" — an entry the user opened
  // and abandoned mid-review ('analyzed'), or whose analysis failed, is still
  // waiting; only saving or discarding resolves it (review finding: it used
  // to vanish from its only surface the moment analyze touched it).
  const { data: waitingRows } = await supabase
    .from("inbox_entries")
    .select("id, original_text, created_at")
    .eq("source", "shortcut")
    .in("processing_status", ["pending", "analyzed", "failed"])
    .order("created_at", { ascending: true })
    .limit(6);
  const waiting = (waitingRows ?? []) as { id: string; original_text: string; created_at: string }[];

  /*
   * Dates, reminders and expiring documents used to live in three separate
   * cards. They answer one question — "what's coming at me?" — so they're
   * merged into a single chronological list. Three cards make the user do
   * the sorting; one list has already done it.
   */
  /*
   * The occasions connection: a date that belongs to a person, arriving
   * within three weeks, gets held against the gift ideas already saved —
   * "you thought of this months ago" surfaced at the moment it helps. The
   * row then leads to the person's hub, where the ideas actually are.
   */
  const GIFT_WINDOW_DAYS = 21;
  const dateRows = (dates ?? []) as Pick<
    ImportantDateRow,
    "id" | "title" | "event_date" | "year_known" | "recurrence" | "person_id"
  >[];
  const personIds = [...new Set(dateRows.map((row) => row.person_id).filter(Boolean))] as string[];
  const [{ data: datePeople }, { data: giftIdeas }] =
    personIds.length > 0
      ? await Promise.all([
          supabase.from("people").select("id, name").in("id", personIds),
          supabase.from("notes").select("title, content").eq("note_type", "gift_idea").limit(50),
        ])
      : [{ data: [] }, { data: [] }];
  const personName = new Map(
    ((datePeople ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]),
  );
  const giftCountFor = (name: string): number => {
    const needle = name.trim().toLowerCase();
    // Short names drown in substring noise — "Al" is inside "calendar" —
    // and a false "gift ideas saved" is worse than a missed one.
    if (needle.length < 3) return 0;
    return ((giftIdeas ?? []) as { title: string | null; content: string }[]).filter((note) =>
      `${note.title ?? ""}\n${note.content}`.toLowerCase().includes(needle),
    ).length;
  };

  const upcoming: UpcomingEntry[] = [
    ...dateRows
      .map((row) => ({ row, next: nextOccurrence(row.event_date, row.recurrence, todayInZone) }))
      .filter((entry): entry is { row: (typeof entry)["row"]; next: Date } => entry.next !== null)
      .map(({ row, next }) => {
        const name = row.person_id ? personName.get(row.person_id) : undefined;
        const gifts =
          name && daysUntil(next, todayInZone) <= GIFT_WINDOW_DAYS ? giftCountFor(name) : 0;
        return {
          key: `date-${row.id}`,
          category: "important_date" as const,
          title: row.title,
          subtitle: `${formatEventDate(row.event_date, row.year_known)}${
            row.recurrence === "yearly" ? " · every year" : ""
          }${gifts > 0 ? ` · ${gifts === 1 ? "a gift idea" : `${gifts} gift ideas`} saved` : ""}`,
          when: next,
          href: row.person_id ? `/people/${row.person_id}` : "/dates",
        };
      }),

    ...((reminders ?? []) as Pick<ReminderRow, "id" | "title" | "remind_at" | "completed">[]).map(
      (row) => ({
        key: `reminder-${row.id}`,
        category: "reminder" as const,
        title: row.title,
        subtitle: "Reminder",
        when: new Date(row.remind_at),
        href: "/dates",
      }),
    ),

    // Future events join the same chronological answer to "what's coming?".
    ...upcomingEvents.map((row) => ({
      key: `event-${row.id}`,
      category: "event" as const,
      title: row.title,
      subtitle: row.summary ?? "Event",
      when: new Date(row.starts_at!),
      href: "/types/event",
    })),

    ...((documents ?? []) as Pick<DocumentRow, "id" | "display_name" | "expiration_date">[])
      .filter((doc) => {
        const status = expiryStatus(doc.expiration_date, todayInZone);
        return status === "expired" || status === "expiring_soon" || status === "expiring_later";
      })
      .map((doc) => ({
        key: `doc-${doc.id}`,
        category: "document" as const,
        title: doc.display_name,
        subtitle: "Expires",
        when: new Date(doc.expiration_date!),
        href: "/documents",
        overdue: expiryStatus(doc.expiration_date, todayInZone) === "expired",
      })),
  ]
    .sort((a, b) => a.when.getTime() - b.when.getTime())
    .slice(0, UPCOMING_LIMIT);

  const recent = [
    ...((recentPeople ?? []) as Pick<PersonRow, "id" | "name" | "created_at">[]).map((p) => ({
      category: "person" as const,
      label: p.name,
      href: `/people/${p.id}`,
      createdAt: p.created_at,
    })),
    ...((recentNotes ?? []) as Pick<NoteRow, "id" | "title" | "content" | "created_at">[]).map(
      (n) => ({
        category: "note" as const,
        label: n.title ?? n.content.slice(0, 60),
        href: "/notes",
        createdAt: n.created_at,
      }),
    ),
    ...((recentRecipes ?? []) as Pick<RecipeRow, "id" | "name" | "created_at">[]).map((r) => ({
      category: "recipe" as const,
      label: r.name,
      href: `/recipes/${r.id}`,
      createdAt: r.created_at,
    })),
  ]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, RECENT_LIMIT);

  const nothingYet =
    upcoming.length === 0 &&
    recent.length === 0 &&
    actionable.length === 0 &&
    happeningToday.length === 0;

  return (
    <Screen>
      <ScreenHeader
        eyebrow={today.toLocaleDateString(undefined, {
          weekday: "long",
          day: "numeric",
          month: "long",
          timeZone,
        })}
        title={`${greeting(partsInZone(today, timeZone).hour)}, ${displayName}`}
      />

      {waiting.length > 0 && (
        <Section title={waiting.length === 1 ? "Waiting for review" : `Waiting for review · ${waiting.length}`}>
          <List>
            {waiting.map((entry) => (
              <ListRow
                key={entry.id}
                icon={Mic}
                iconClassName="bg-primary/10 text-primary"
                title={entry.original_text}
                subtitle={`From Siri, ${formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })} — tap to review`}
                href={`/?${SHARED_TEXT_PARAM}=${encodeURIComponent(entry.original_text)}&${SHARED_ENTRY_PARAM}=${entry.id}`}
              />
            ))}
          </List>
        </Section>
      )}

      {nothingYet && waiting.length === 0 ? (
        <Empty
          icon={Sparkles}
          title="Your memory is empty"
          description="Tap the + button and tell MeOS something worth keeping — a birthday, an allergy, where you left the spare key."
        />
      ) : (
        <>
          {/* Overdue comes first and is the only red thing on the screen. */}
          {overdue.length > 0 && (
            <Section title={overdue.length === 1 ? "Overdue" : `Overdue · ${overdue.length}`}>
              <List>
                {overdue.map((item) => (
                  <ActionableRow key={item.id} item={item} />
                ))}
              </List>
            </Section>
          )}

          {dueToday.length > 0 && (
            <Section title="To do today">
              <List>
                {dueToday.map((item) => (
                  <ActionableRow key={item.id} item={item} />
                ))}
              </List>
            </Section>
          )}

          {/* Events are attended, not ticked off, so they get plain rows
              rather than ActionableRow's checkbox. */}
          {happeningToday.length > 0 && (
            <Section title="Happening today">
              <List>
                {happeningToday.map((row) => {
                  const meta = CATEGORY_META.event;
                  return (
                    <ListRow
                      key={row.id}
                      icon={meta.icon}
                      iconClassName={meta.chipClass}
                      title={row.title}
                      subtitle={row.summary ?? undefined}
                      href="/types/event"
                      trailing={
                        <span
                          data-numeric
                          className="text-xs font-medium text-muted-foreground whitespace-nowrap"
                        >
                          {row.all_day
                            ? "All day"
                            : (dueLabel(row.starts_at, row.all_day, today, timeZone) ?? "")}
                        </span>
                      }
                    />
                  );
                })}
              </List>
            </Section>
          )}

          {upcoming.length > 0 && (
            <Section title="Coming up" href="/dates">
              <List>
                {upcoming.map((entry) => {
                  const meta = CATEGORY_META[entry.category];
                  return (
                    <ListRow
                      key={entry.key}
                      icon={meta.icon}
                      iconClassName={meta.chipClass}
                      title={entry.title}
                      subtitle={entry.subtitle}
                      href={entry.href}
                      trailing={<Countdown when={entry.when} overdue={entry.overdue} />}
                    />
                  );
                })}
              </List>
            </Section>
          )}

          {recent.length > 0 && (
            <Section title="Recently saved" href="/memory">
              <List>
                {recent.map((item) => {
                  const meta = CATEGORY_META[item.category];
                  return (
                    <ListRow
                      key={`${item.category}-${item.href}-${item.createdAt}`}
                      icon={meta.icon}
                      iconClassName={meta.chipClass}
                      title={item.label}
                      href={item.href}
                      trailing={
                        <time
                          dateTime={item.createdAt}
                          className="text-xs text-muted-foreground whitespace-nowrap"
                        >
                          {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                        </time>
                      }
                    />
                  );
                })}
              </List>
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}
