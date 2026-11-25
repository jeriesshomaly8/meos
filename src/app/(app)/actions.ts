"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { snoozeUntil } from "@/lib/alarms/snooze";
import { advancedDueAt } from "@/lib/temporal/recurrence";
import { MAX_IMPORTED_CONTACTS, normaliseContactNames } from "@/lib/contacts/picker";

/**
 * Small server actions for record housekeeping. Every query runs under the
 * caller's session, so RLS guarantees users can only touch their own rows.
 */

const deletableTables = z.enum([
  "people",
  "person_preferences",
  "important_dates",
  "reminders",
  "food_preferences",
  "recipes",
  "documents",
  "notes",
]);

export async function deleteRecord(table: string, id: string): Promise<{ error?: string }> {
  const parsedTable = deletableTables.safeParse(table);
  const parsedId = z.uuid().safeParse(id);
  if (!parsedTable.success || !parsedId.success) {
    return { error: "Invalid request" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase.from(parsedTable.data).delete().eq("id", parsedId.data);
  if (error) {
    return { error: "Couldn't delete this item. Please try again." };
  }
  revalidatePath("/", "layout");
  return {};
}

/**
 * Ticking a task off Today. Goes through the `set_item_done` RPC rather than a
 * direct update so `status` and `completed_at` can never disagree — the
 * database trigger owns that pairing.
 *
 * A recurring item is the exception: done means done *with this round*, so
 * instead of finishing it, its date advances along the stored rule and the
 * row stays active. The whole alarm stack — ring screen, push nag, Today —
 * repeats for free, because they all read `due_at`.
 */
export async function setItemDone(
  id: string,
  done: boolean,
): Promise<{ error?: string; advancedTo?: string; previousDueAt?: string }> {
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) return { error: "Invalid request" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  if (done) {
    const [{ data: item }, { data: profile }] = await Promise.all([
      supabase
        .from("items")
        .select("rrule, due_at, attributes")
        .eq("id", parsedId.data)
        .maybeSingle(),
      supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
    ]);
    const rrule = item?.rrule as string | null | undefined;
    const dueAt = item?.due_at as string | null | undefined;
    if (rrule && dueAt) {
      const timeZone = (profile?.timezone as string | null) ?? "UTC";
      /*
       * Advance from the *scheduled* time, not the snoozed one: a 07:00 alarm
       * snoozed to 07:09 must ring at 07:00 tomorrow, not drift nine minutes
       * per snooze forever (review finding). `snoozeAlarm` parks the original
       * under attributes.scheduled_due_at; advancing consumes it.
       */
      const attributes = (item?.attributes ?? {}) as Record<string, unknown>;
      const scheduled =
        typeof attributes.scheduled_due_at === "string" ? attributes.scheduled_due_at : dueAt;
      const next = advancedDueAt(rrule, new Date(scheduled), new Date(), timeZone);
      if (next) {
        const cleaned = { ...attributes };
        delete cleaned.scheduled_due_at;
        const { error } = await supabase
          .from("items")
          .update({ due_at: next.toISOString(), attributes: cleaned })
          .eq("id", parsedId.data);
        if (error) return { error: "Couldn't update this. Please try again." };
        revalidatePath("/", "layout");
        return { advancedTo: next.toISOString(), previousDueAt: dueAt };
      }
    }
  }

  const { error } = await supabase.rpc("set_item_done", { p_id: parsedId.data, p_done: done });
  if (error) {
    return { error: "Couldn't update this. Please try again." };
  }
  revalidatePath("/", "layout");
  return {};
}

/**
 * The undo path for a recurring completion: put the date back where it was.
 * RLS scopes the update; the value is validated as a real instant here so a
 * tampered client cannot park an alarm on garbage.
 */
export async function setItemDueAt(id: string, dueAt: string): Promise<{ error?: string }> {
  const parsedId = z.uuid().safeParse(id);
  const parsedDueAt = z.string().datetime({ offset: true }).safeParse(dueAt);
  if (!parsedId.success || !parsedDueAt.success) return { error: "Invalid request" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase
    .from("items")
    .update({ due_at: parsedDueAt.data })
    .eq("id", parsedId.data);
  if (error) return { error: "Couldn't undo that. Please try again." };
  revalidatePath("/", "layout");
  return {};
}

/** Ticking one line off a list. */
export async function setListItemChecked(
  id: string,
  checked: boolean,
): Promise<{ error?: string }> {
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) return { error: "Invalid request" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase.rpc("set_list_item_checked", {
    p_id: parsedId.data,
    p_checked: checked,
  });
  if (error) {
    return { error: "Couldn't update this. Please try again." };
  }
  revalidatePath("/", "layout");
  return {};
}

/**
 * Snoozing an alarm. The new instant is computed by `src/lib/alarms/snooze` on
 * the caller's side so the arithmetic is unit-tested; this only re-derives it
 * from the server's clock so a stale or tampered client can't push an alarm to
 * an arbitrary time.
 */
export async function snoozeAlarm(id: string): Promise<{ error?: string; dueAt?: string }> {
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) return { error: "Invalid request" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  /*
   * For a recurring alarm the pre-snooze time is the *schedule* — parked in
   * attributes before the snooze overwrites due_at, so the next advance
   * anchors on 07:00 and not on 07:09. Only the first snooze writes it; a
   * second snooze must not overwrite the schedule with the first snooze.
   */
  const { data: item } = await supabase
    .from("items")
    .select("rrule, due_at, attributes")
    .eq("id", parsedId.data)
    .maybeSingle();
  if (item?.rrule && item.due_at) {
    const attributes = (item.attributes ?? {}) as Record<string, unknown>;
    if (typeof attributes.scheduled_due_at !== "string") {
      await supabase
        .from("items")
        .update({ attributes: { ...attributes, scheduled_due_at: item.due_at } })
        .eq("id", parsedId.data);
    }
  }

  const dueAt = snoozeUntil(new Date());
  const { error } = await supabase.rpc("snooze_alarm", {
    p_id: parsedId.data,
    p_due_at: dueAt.toISOString(),
  });
  if (error) return { error: "Couldn't snooze this alarm. Please try again." };

  revalidatePath("/", "layout");
  return { dueAt: dueAt.toISOString() };
}

const contactNamesSchema = z
  .array(z.string().trim().min(1).max(80))
  .min(1, "Nobody was selected")
  .max(MAX_IMPORTED_CONTACTS);

/**
 * Seeding people from the phone's address book (§6.3 G).
 *
 * The names arrive from a browser API, so they are re-validated and
 * re-deduplicated here rather than trusted: the client's filtering is there to
 * keep the count honest in the UI, and this is the copy that decides what gets
 * written. Nothing but a name is stored.
 */
export async function importContacts(
  names: string[],
): Promise<{ error?: string; added?: number; skipped?: number }> {
  const parsed = contactNamesSchema.safeParse(names);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Those contacts couldn't be read." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: existing, error: readError } = await supabase.from("people").select("name");
  if (readError) return { error: "Couldn't check who you already have saved." };

  const fresh = normaliseContactNames(
    parsed.data,
    (existing ?? []).map((row) => row.name as string),
  );
  const skipped = parsed.data.length - fresh.length;
  if (fresh.length === 0) return { added: 0, skipped };

  const { error } = await supabase
    .from("people")
    .insert(fresh.map((name) => ({ user_id: user.id, name })));
  if (error) return { error: "Couldn't save those contacts. Please try again." };

  revalidatePath("/people");
  return { added: fresh.length, skipped };
}

/**
 * The published calendar feed (§6.3 E).
 *
 * Three verbs over one row: turn it on, replace the link, turn it off. The
 * token is generated in the database — a client-chosen feed URL would be a
 * client-chosen password — and the same function is safe to call twice, so a
 * double tap cannot mint two feeds.
 */
export async function createCalendarFeed(): Promise<{ error?: string; token?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase.rpc("ensure_calendar_feed");
  if (error) return { error: "Couldn't publish your calendar. Please try again." };
  revalidatePath("/settings");
  return { token: data as string };
}

/** Replaces the token. Every client subscribed to the old URL stops updating. */
export async function rotateCalendarFeed(): Promise<{ error?: string; token?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase.rpc("rotate_calendar_feed");
  if (error) return { error: "Couldn't replace the link. Please try again." };
  revalidatePath("/settings");
  return { token: data as string };
}

export async function revokeCalendarFeed(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase.rpc("revoke_calendar_feed");
  if (error) return { error: "Couldn't turn the calendar feed off. Please try again." };
  revalidatePath("/settings");
  return {};
}

/**
 * The capture-from-anywhere token (§v2.1) — same three verbs as the calendar
 * feed, same reasoning: the token is minted in the database, and rotation and
 * revocation are both "the old URL stops working".
 */
export async function ensureCaptureToken(): Promise<{ error?: string; token?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase.rpc("ensure_capture_token");
  if (error) return { error: "Couldn't turn capture on. Please try again." };
  revalidatePath("/settings");
  return { token: data as string };
}

export async function rotateCaptureToken(): Promise<{ error?: string; token?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase.rpc("rotate_capture_token");
  if (error) return { error: "Couldn't replace the link. Please try again." };
  revalidatePath("/settings");
  return { token: data as string };
}

export async function revokeCaptureToken(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase.rpc("revoke_capture_token");
  if (error) return { error: "Couldn't turn capture off. Please try again." };
  revalidatePath("/settings");
  return {};
}

export async function setReminderCompleted(
  id: string,
  completed: boolean,
): Promise<{ error?: string }> {
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) return { error: "Invalid request" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase
    .from("reminders")
    .update({ completed })
    .eq("id", parsedId.data);
  if (error) return { error: "Couldn't update the reminder." };
  revalidatePath("/", "layout");
  return {};
}

const profileSchema = z
  .object({
    displayName: z.string().trim().min(1, "Display name can't be empty").max(80),
    timezone: z.string().min(1).max(64),
  })
  .strict();

export async function updateProfile(input: {
  displayName: string;
  timezone: string;
}): Promise<{ error?: string }> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: parsed.data.displayName, timezone: parsed.data.timezone })
    .eq("id", user.id);
  if (error) return { error: "Couldn't save your profile." };
  revalidatePath("/", "layout");
  return {};
}

export async function deleteAllMyData(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase.rpc("delete_all_my_data");
  if (error) return { error: "Couldn't delete your data. Please try again." };
  revalidatePath("/", "layout");
  return {};
}

export async function setNotePinned(id: string, pinned: boolean): Promise<{ error?: string }> {
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) return { error: "Invalid request" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase.from("notes").update({ pinned }).eq("id", parsedId.data);
  if (error) return { error: "Couldn't update the note." };
  revalidatePath("/notes");
  return {};
}
