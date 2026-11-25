import { describe, expect, it } from "vitest";
import {
  dueLabel,
  groupByDue,
  listProgress,
  toActionableItem,
  type ItemRow,
} from "@/lib/items/rows";

/**
 * The read layer behind Today, Tasks, Lists and Memory.
 *
 * Every boundary here is computed in the user's zone rather than the server's —
 * the §1.6 bug. The clock is fixed at a Jerusalem evening because that is
 * exactly the window where a UTC host disagrees about what day it is.
 */

const TZ = "Asia/Jerusalem";
const NOW = new Date("2026-08-10T15:30:00Z"); // Mon 10 Aug, 18:30 local (UTC+3)

function row(overrides: Partial<ItemRow> = {}): ItemRow {
  return {
    id: "i1",
    capability: "task",
    title: "Buy milk",
    summary: null,
    status: "active",
    due_at: null,
    all_day: true,
    starts_at: null,
    ends_at: null,
    completed_at: null,
    created_at: "2026-08-10T10:00:00Z",
    list_items: [],
    ...overrides,
  };
}

describe("dueLabel", () => {
  it("says nothing when there is no date", () => {
    expect(dueLabel(null, true, NOW, TZ)).toBeNull();
  });

  it("says nothing for an all-day item due today — the section already said it", () => {
    expect(dueLabel("2026-08-10T00:00:00+03:00", true, NOW, TZ)).toBeNull();
  });

  it("gives just the clock for a timed item due today, converted into the zone", () => {
    // 18:00 UTC is 21:00 in Jerusalem — the label must be the local reading.
    expect(dueLabel("2026-08-10T18:00:00Z", false, NOW, TZ)).toBe("21:00");
    expect(dueLabel("2026-08-10T18:00:00Z", false, NOW, "UTC")).toBe("18:00");
  });

  it("names yesterday rather than counting one day", () => {
    expect(dueLabel("2026-08-08T21:00:00Z", true, NOW, TZ)).toBe("Yesterday");
  });

  it("counts the days once it is further back, and keeps the time", () => {
    expect(dueLabel("2026-08-07T06:00:00Z", false, NOW, TZ)).toBe("3 days ago, 09:00");
  });

  it("names tomorrow", () => {
    expect(dueLabel("2026-08-11T04:00:00Z", false, NOW, TZ)).toBe("Tomorrow, 07:00");
    expect(dueLabel("2026-08-10T21:00:00Z", true, NOW, TZ)).toBe("Tomorrow");
  });

  it("falls back to a weekday and date further out", () => {
    expect(dueLabel("2026-08-13T21:00:00Z", true, NOW, TZ)).toBe("Fri 14 Aug");
  });

  /*
   * 21:00 UTC on 10 Aug is already 11 Aug in Jerusalem. A server computing this
   * in its own zone would call it "today" for three hours every evening.
   */
  it("reads the day boundary in the user's zone, not the server's", () => {
    expect(dueLabel("2026-08-10T21:00:00Z", true, NOW, TZ)).toBe("Tomorrow");
    expect(dueLabel("2026-08-10T21:00:00Z", true, NOW, "UTC")).toBeNull();
  });
});

describe("groupByDue", () => {
  const rows = [
    row({ id: "overdue", due_at: "2026-08-08T21:00:00Z" }),
    row({ id: "today", due_at: "2026-08-10T15:00:00Z", all_day: false }),
    row({ id: "later", due_at: "2026-08-13T21:00:00Z" }),
    row({ id: "someday", due_at: null }),
  ];
  const groups = groupByDue(rows, NOW, TZ);

  it("puts each row in exactly one bucket", () => {
    expect(groups.overdue.map((i) => i.id)).toEqual(["overdue"]);
    expect(groups.today.map((i) => i.id)).toEqual(["today"]);
    expect(groups.upcoming.map((i) => i.id)).toEqual(["later"]);
    expect(groups.undated.map((i) => i.id)).toEqual(["someday"]);
  });

  /*
   * The reason the Tasks screen exists. Today asks "due by tonight?", so a task
   * with no date answered no and was never rendered anywhere.
   */
  it("keeps undated work rather than dropping it", () => {
    expect(groups.undated).toHaveLength(1);
    expect(groups.undated[0]!.whenLabel).toBeNull();
  });

  it("marks only the overdue bucket overdue", () => {
    expect(groups.overdue[0]!.overdue).toBe(true);
    expect(groups.today[0]!.overdue).toBe(false);
    expect(groups.undated[0]!.overdue).toBe(false);
  });
});

describe("toActionableItem", () => {
  it("orders list rows by position, not by the order PostgREST returned them", () => {
    const item = toActionableItem(
      row({
        capability: "list",
        list_items: [
          { id: "c", text: "Eggs", quantity: null, unit: null, checked_at: null, position: 2 },
          { id: "a", text: "Milk", quantity: 2, unit: "l", checked_at: null, position: 0 },
          { id: "b", text: "Bread", quantity: null, unit: null, checked_at: "x", position: 1 },
        ],
      }),
      NOW,
      TZ,
    );
    expect(item.listItems.map((entry) => entry.text)).toEqual(["Milk", "Bread", "Eggs"]);
  });

  it("reads a checked line off the timestamp, not a boolean", () => {
    const item = toActionableItem(
      row({
        list_items: [
          { id: "a", text: "Milk", quantity: null, unit: null, checked_at: null, position: 0 },
          {
            id: "b",
            text: "Bread",
            quantity: null,
            unit: null,
            checked_at: "2026-08-10T09:00:00Z",
            position: 1,
          },
        ],
      }),
      NOW,
      TZ,
    );
    expect(item.listItems.map((entry) => entry.checked)).toEqual([false, true]);
  });

  it("carries the done state through, so a finished task renders as finished", () => {
    expect(toActionableItem(row({ status: "done" }), NOW, TZ).done).toBe(true);
    expect(toActionableItem(row({ status: "active" }), NOW, TZ).done).toBe(false);
  });
});

describe("listProgress", () => {
  it("counts ticked lines against the total", () => {
    const progress = listProgress(
      row({
        list_items: [
          { id: "a", text: "Milk", quantity: null, unit: null, checked_at: "x", position: 0 },
          { id: "b", text: "Bread", quantity: null, unit: null, checked_at: null, position: 1 },
          { id: "c", text: "Eggs", quantity: null, unit: null, checked_at: "x", position: 2 },
        ],
      }),
    );
    expect(progress).toEqual({ checked: 2, total: 3 });
  });

  it("reports an empty list as zero of zero rather than complete", () => {
    expect(listProgress(row())).toEqual({ checked: 0, total: 0 });
  });
});
