import { NextResponse } from "next/server";
import webpush from "web-push";
import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import { apiError } from "@/lib/api";
import { supabaseUrl } from "@/lib/supabase/config";
import { authorizedByCronSecret } from "@/lib/push/cron-auth";
import { alarmPushPayload, pushTopic, subscriptionFate } from "@/lib/push/escalation";

/**
 * The sender half of §6.3 C: called by a scheduler (pg_cron on Supabase via
 * pg_net — see scripts/push-cron.sql), it delivers one escalation attempt for
 * every alarm currently inside the push window.
 *
 * Deliberately single-tick. The endpoint does not sleep or loop towards the
 * next attempt; it answers "what is due *right now*" and exits. All pacing
 * lives in the cron schedule and all idempotency in `alarm_deliveries`, so
 * the cadence can be 20 seconds (the design), a minute (a degraded external
 * cron), or two overlapping runs, without double-delivering a single attempt.
 *
 * Escalation stops on its own: `due_alarm_pushes()` only returns alarms that
 * are `status = 'active'` and inside the window. Dismissing sets `done`,
 * snoozing moves `due_at` forward, and the window lapsing ends the nag — no
 * state machine to keep in sync.
 */

/**
 * Seconds a queued push stays deliverable. Attempts supersede each other every
 * 20s and share a topic, so anything older than a minute is stale by
 * construction — better silence than a burst of history on reconnect.
 */
const PUSH_TTL_S = 60;

interface DuePush {
  item_id: string;
  user_id: string;
  title: string | null;
  due_at: string;
  attempt: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

async function deliver(admin: SupabaseClient, row: DuePush): Promise<"sent" | "dead" | "failed"> {
  try {
    await webpush.sendNotification(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      JSON.stringify(alarmPushPayload(row.item_id, row.title)),
      { TTL: PUSH_TTL_S, urgency: "high", topic: pushTopic(row.item_id) },
    );
  } catch (error) {
    const statusCode = error instanceof webpush.WebPushError ? error.statusCode : undefined;
    if (subscriptionFate(statusCode) === "dead") {
      // The push service says this endpoint no longer exists. The row is
      // disposable by design (migration …0011) — delete, don't retry.
      await admin.from("push_subscriptions").delete().eq("endpoint", row.endpoint);
      return "dead";
    }
    const { data: current } = await admin
      .from("push_subscriptions")
      .select("failure_count")
      .eq("endpoint", row.endpoint)
      .maybeSingle();
    await admin
      .from("push_subscriptions")
      .update({ failure_count: ((current?.failure_count as number | undefined) ?? 0) + 1 })
      .eq("endpoint", row.endpoint);
    console.error("[push] send failed:", statusCode ?? "network", "attempt", row.attempt);
    return "failed";
  }

  await admin
    .from("push_subscriptions")
    .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
    .eq("endpoint", row.endpoint);
  return "sent";
}

async function handler(request: Request) {
  const secret = process.env.CRON_SECRET;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;

  if (!secret || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return apiError("NOT_CONFIGURED", "Push delivery isn't configured on this server.", 503);
  }
  if (!authorizedByCronSecret(request.headers.get("authorization"), secret)) {
    return apiError("UNAUTHENTICATED", "This endpoint is for the alarm scheduler.", 401);
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const admin = createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin.rpc("due_alarm_pushes");
  if (error) {
    console.error("[push] due_alarm_pushes failed:", error.message);
    return apiError("INTERNAL_ERROR", "Couldn't read due alarms.", 500);
  }

  const due = (data ?? []) as DuePush[];
  let sent = 0;
  let dead = 0;
  let failed = 0;
  let lost = 0;

  const results = await Promise.all(
    due.map(async (row) => {
      // Claim before sending: the loser of a race between overlapping cron
      // ticks skips the attempt instead of double-notifying. Claims are per
      // device — every subscription gets its own chime.
      const { data: claimed, error: claimError } = await admin.rpc("record_alarm_push", {
        p_item_id: row.item_id,
        p_user_id: row.user_id,
        p_due_at: row.due_at,
        p_attempt: row.attempt,
        p_endpoint: row.endpoint,
      });
      if (claimError) {
        console.error("[push] claim failed:", claimError.message);
        return "failed" as const;
      }
      if (!claimed) return "lost" as const;
      return deliver(admin, row);
    }),
  );

  for (const result of results) {
    if (result === "sent") sent += 1;
    else if (result === "dead") dead += 1;
    else if (result === "failed") failed += 1;
    else lost += 1;
  }

  return NextResponse.json({ due: due.length, sent, dead, failed, lost });
}

// POST for pg_net's http_post; GET so an external fallback cron can be pointed
// at the same URL without code changes. Both carry the same bearer secret.
export { handler as GET, handler as POST };
