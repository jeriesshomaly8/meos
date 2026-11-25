import { daysBetweenInZone } from "@/lib/temporal/zone";

/**
 * Reading the universal `items` table.
 *
 * Today built its own row cast and its own "Yesterday / 09:00" wording inline.
 * Three more screens now want the same rows, and copying a twenty-line cast
 * four times is how the four-places-to-edit problem in §1.5 started. The query
 * shape, the row type and the mapping live here once.
 */

/** Capabilities stored in `items` rather than one of the seven legacy tables. */
export type ItemCapability = "task" | "list" | "alarm" | "event";

/**
 * Every column the screens read, as one string, because PostgREST takes the
 * projection as text and a typo in it fails at runtime rather than at build.
 */
export const ITEM_SELECT =
  "id, capability, title, summary, status, due_at, all_day, starts_at, ends_at, completed_at, created_at, " +
  "list_items(id, text, quantity, unit, checked_at, position)";

export interface ItemListItemRow {
  id: string;
  text: string;
  quantity: number | null;
  unit: string | null;
  checked_at: string | null;
  position: number;
}

export interface ItemRow {
  id: string;
  capability: ItemCapability;
  title: string;
  summary: string | null;
  status: string;
  due_at: string | null;
  all_day: boolean;
  /** An event's span. Everything actionable uses `due_at` instead. */
  starts_at: string | null;
  ends_at: string | null;
  completed_at: string | null;
  created_at: string;
  list_items: ItemListItemRow[];
}

/**
 * The instant a row is *about*. Tasks, lists and alarms carry `due_at`;
 * an event carries `starts_at` — one accessor so no screen falls into the
 * "event lands in undated" trap.
 */
export function anchorInstant(row: Pick<ItemRow, "due_at" | "starts_at">): string | null {
  return row.due_at ?? row.starts_at;
}

export interface ActionableListItem {
  id: string;
  text: string;
  quantity: number | null;
  unit: string | null;
  checked: boolean;
}

export interface ActionableItem {
  id: string;
  capability: ItemCapability;
  title: string;
  summary: string | null;
  /** Rendered as-is; the server already formatted it in the user's zone. */
  whenLabel: string | null;
  overdue: boolean;
  done: boolean;
  listItems: ActionableListItem[];
}

/**
 * PostgREST returns an embedded table as a nested array, which the generated
 * types describe loosely enough that a cast is unavoidable. Confining it to one
 * function means the screens never write one.
 */
export function asItemRows(data: unknown): ItemRow[] {
  return (data ?? []) as ItemRow[];
}

/**
 * How a due date reads to someone looking at it today.
 *
 * Null means "no label worth showing": an all-day item due today has nothing to
 * add beyond the section it is already sitting under. Every comparison is made
 * in the user's zone — on a UTC host this is the difference between "due today"
 * being right and being wrong for the last three hours of a Jerusalem evening.
 */
export function dueLabel(
  dueAt: string | null,
  allDay: boolean,
  now: Date,
  timeZone: string,
): string | null {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  const dayDelta = daysBetweenInZone(now, due, timeZone);

  const clock = allDay
    ? null
    : new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(due);

  if (dayDelta < 0) {
    const ago = dayDelta === -1 ? "Yesterday" : `${Math.abs(dayDelta)} days ago`;
    return clock ? `${ago}, ${clock}` : ago;
  }
  if (dayDelta === 0) return clock;
  if (dayDelta === 1) return clock ? `Tomorrow, ${clock}` : "Tomorrow";

  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(due);
  return clock ? `${day}, ${clock}` : day;
}

export function toActionableItem(row: ItemRow, now: Date, timeZone: string): ActionableItem {
  const anchor = anchorInstant(row);
  const dayDelta = anchor ? daysBetweenInZone(now, new Date(anchor), timeZone) : null;
  return {
    id: row.id,
    capability: row.capability,
    title: row.title,
    summary: row.summary,
    whenLabel: dueLabel(anchor, row.all_day, now, timeZone),
    // A past event is over, not overdue — nothing about it is still owed.
    overdue: row.capability !== "event" && dayDelta !== null && dayDelta < 0,
    done: row.status === "done",
    listItems: [...row.list_items]
      .sort((a, b) => a.position - b.position)
      .map((entry) => ({
        id: entry.id,
        text: entry.text,
        quantity: entry.quantity,
        unit: entry.unit,
        checked: entry.checked_at !== null,
      })),
  };
}

export interface DueGroups {
  overdue: ActionableItem[];
  today: ActionableItem[];
  upcoming: ActionableItem[];
  /** Saved with no day at all — the state Today could never show. */
  undated: ActionableItem[];
  /** Events whose day has gone. Over, not overdue — nothing is still owed. */
  past: ActionableItem[];
}

/**
 * Splits by when, not by type.
 *
 * `undated` is the group that justifies the whole screen: an undated task never
 * appears on Today, because Today asks "what is due by tonight?" and the answer
 * for a task with no date is no. Without a bucket for them they were saved and
 * then invisible.
 */
export function groupByDue(
  rows: ItemRow[],
  now: Date,
  timeZone: string,
): DueGroups {
  const groups: DueGroups = { overdue: [], today: [], upcoming: [], undated: [], past: [] };

  for (const row of rows) {
    const item = toActionableItem(row, now, timeZone);
    const anchor = anchorInstant(row);
    if (!anchor) {
      groups.undated.push(item);
      continue;
    }
    const dayDelta = daysBetweenInZone(now, new Date(anchor), timeZone);
    if (dayDelta < 0) {
      (row.capability === "event" ? groups.past : groups.overdue).push(item);
    } else if (dayDelta === 0) {
      groups.today.push(item);
    } else {
      groups.upcoming.push(item);
    }
  }

  return groups;
}

/** Ticked-off count for a list, for the progress a list screen wants to show. */
export function listProgress(row: ItemRow): { checked: number; total: number } {
  return {
    checked: row.list_items.filter((entry) => entry.checked_at !== null).length,
    total: row.list_items.length,
  };
}
