import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AlarmRing } from "./alarm-ring";

export const metadata: Metadata = { title: "Alarm" };

/**
 * Deliberately outside the `(app)` route group.
 *
 * A ringing alarm is a full-screen takeover with two targets — Snooze and
 * Dismiss — so it must not render the tab bar. That is the only thing the app
 * layout provides that this screen needs to drop, and the auth redirect it
 * also provides is three lines to repeat.
 *
 * `dynamic = "force-dynamic"` because the whole page is "is it time yet": a
 * cached copy of an alarm screen is worse than useless.
 */
export const dynamic = "force-dynamic";

export default async function AlarmPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: item }, { data: profile }] = await Promise.all([
    supabase
      .from("items")
      .select("id, title, status, due_at, attributes")
      .eq("id", id)
      .eq("capability", "alarm")
      .maybeSingle(),
    supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
  ]);

  if (!item) notFound();

  return (
    <AlarmRing
      id={item.id as string}
      title={item.title as string}
      dueAt={item.due_at as string}
      dismissed={(item.status as string) === "done"}
      snoozeCount={
        Number((item.attributes as Record<string, unknown> | null)?.snooze_count ?? 0) || 0
      }
      timeZone={(profile?.timezone as string | null) ?? "UTC"}
    />
  );
}
