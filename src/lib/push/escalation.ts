/**
 * The arithmetic half of push escalation, kept pure so the stop conditions are
 * testable without a database or a push service.
 *
 * The authoritative copy of these rules lives in `due_alarm_pushes()`
 * (migration …0011) — SQL is what actually decides who gets pushed. This
 * module mirrors it constant for constant so the tests can pin the behaviour
 * and a drift between the two reads as a failing test, not a mystery on a
 * phone.
 */

/** Seconds between escalation attempts. One chime is missable; a sequence is an alarm. */
export const ESCALATION_INTERVAL_S = 20;

/**
 * How long the escalation keeps nagging, in seconds. Past this the alarm is
 * the foreground path's problem (`isMissed` and the ring screen's grace
 * window) — a push arriving much later than the alarm would ambush its owner.
 */
export const ESCALATION_WINDOW_S = 300;

/** Attempt numbers run 0..14: floor(elapsed / 20s) inside a 300s window. */
export const MAX_ATTEMPT = Math.floor((ESCALATION_WINDOW_S - 1) / ESCALATION_INTERVAL_S);

/** Which escalation attempt `now` falls in. Mirrors the SQL's floor(epoch/20). */
export function attemptNumber(dueAt: Date, now: Date): number {
  return Math.floor((now.getTime() - dueAt.getTime()) / 1000 / ESCALATION_INTERVAL_S);
}

export type EscalationPhase = "pending" | "escalating" | "lapsed";

/**
 * Where an alarm stands relative to the push window. `due_at <= now` and
 * `due_at > now - window` in the SQL; the boundary at exactly `window` seconds
 * is *lapsed*, pinned by tests either side.
 */
export function escalationPhase(dueAt: Date, now: Date): EscalationPhase {
  const elapsedMs = now.getTime() - dueAt.getTime();
  if (elapsedMs < 0) return "pending";
  if (elapsedMs >= ESCALATION_WINDOW_S * 1000) return "lapsed";
  return "escalating";
}

export type SubscriptionFate = "dead" | "transient";

/**
 * What a push-service error means for the subscription row.
 *
 * 404 and 410 are the service saying "this endpoint no longer exists" — the
 * browser reinstalled, the user cleared data, the subscription expired. The
 * row is deleted, not retried. Everything else (429, 5xx, network) is a bad
 * moment, counted but kept.
 */
export function subscriptionFate(statusCode: number | undefined): SubscriptionFate {
  return statusCode === 404 || statusCode === 410 ? "dead" : "transient";
}

/**
 * Collapse key for the push service's queue: while the device is offline,
 * fifteen queued escalations collapse into the newest one instead of arriving
 * as a burst when it reconnects. The spec allows at most 32 base64url
 * characters; a UUID with its dashes stripped is exactly 32 hex characters.
 */
export function pushTopic(itemId: string): string {
  return itemId.replace(/-/g, "");
}

export interface AlarmPushPayload {
  title: string;
  body: string;
  itemId: string;
  kind: "alarm";
}

/** What `public/sw.js` expects to find in `event.data.json()`. */
export function alarmPushPayload(itemId: string, title: string | null): AlarmPushPayload {
  return {
    title: title?.trim() || "Alarm",
    body: "Tap to open MeOS and silence it.",
    itemId,
    kind: "alarm",
  };
}
