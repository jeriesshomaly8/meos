"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isRinging, msUntil } from "@/lib/alarms/snooze";

/**
 * The foreground half of Phase 9, and the only fully reliable half.
 *
 * With the app open, a client timer fires exactly on time and the ring screen
 * loops audio through WebAudio — no push service, no server, no connectivity
 * required at the moment it fires. Web Push (still to build) covers the app
 * being closed, but it is best-effort by construction: it obeys Do Not
 * Disturb, needs a live connection, and can be delayed by Doze.
 *
 * Mounted once in the app layout. It renders nothing.
 */

/** Alarms further out than this aren't loaded yet; the poll will pick them up. */
const LOOKAHEAD_MS = 60 * 60 * 1000;
/** Re-query for alarms created or snoozed in another tab, or on another device. */
const POLL_MS = 5 * 60 * 1000;
/** setTimeout overflows past 2^31-1 ms and fires immediately. Never reached at a 1h lookahead — a guard, not a case. */
const MAX_TIMEOUT_MS = 2_147_483_647;

interface ArmedAlarm {
  id: string;
  due_at: string;
}

export function AlarmScheduler() {
  const router = useRouter();
  const pathname = usePathname();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /*
   * Alarms already sent to the ring screen this session. Without it, coming
   * back from /alarm/[id] without dismissing (the browser back button) would
   * immediately bounce the user back into the ring screen, with no way out.
   */
  const firedRef = useRef<Set<string>>(new Set());
  const onAlarmScreen = pathname?.startsWith("/alarm/") ?? false;

  const ring = useCallback(
    (id: string) => {
      firedRef.current.add(id);
      router.push(`/alarm/${id}`);
    },
    [router],
  );

  const schedule = useCallback(async () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (onAlarmScreen) return;

    const supabase = createClient();
    const now = new Date();
    const { data, error } = await supabase
      .from("items")
      .select("id, due_at")
      .eq("capability", "alarm")
      .eq("status", "active")
      .not("due_at", "is", null)
      .lte("due_at", new Date(now.getTime() + LOOKAHEAD_MS).toISOString())
      .order("due_at", { ascending: true })
      .limit(20);

    // A failed poll is not worth interrupting the user over — the next one is
    // five minutes away and nothing on screen depends on it.
    if (error || !data) return;

    const pendingAlarms = (data as ArmedAlarm[]).filter((row) => !firedRef.current.has(row.id));

    const overdue = pendingAlarms.find((row) => isRinging(new Date(row.due_at), now));
    if (overdue) {
      ring(overdue.id);
      return;
    }

    const next = pendingAlarms.find((row) => msUntil(new Date(row.due_at), now) > 0);
    if (!next) return;

    const delay = Math.min(msUntil(new Date(next.due_at), now), MAX_TIMEOUT_MS);
    timerRef.current = setTimeout(() => ring(next.id), delay);
  }, [onAlarmScreen, ring]);

  useEffect(() => {
    void schedule();
    const poll = setInterval(() => void schedule(), POLL_MS);

    /*
     * Background tabs get their timers throttled, so a timeout set for 07:00
     * can fire late. Re-checking on wake turns "late by however long the tab
     * was hidden" into "late by the time it takes to run one query".
     */
    const onVisible = () => {
      if (document.visibilityState === "visible") void schedule();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [schedule]);

  return null;
}
