/**
 * Snooze arithmetic.
 *
 * Pure and clock-injected for the same reason as `src/lib/temporal`: the one
 * thing a snooze must never do is land in the past or drift, and neither is
 * testable if the function reads the clock itself.
 *
 * Minutes are added to the absolute instant rather than to a wall-clock field,
 * so no zone or DST handling is needed here — nine minutes after 01:59 on a
 * transition night is nine minutes later whatever the clock on the wall says.
 */

/**
 * The mechanical-clock convention: snooze bars were geared to about nine
 * minutes because a single-digit counter was cheaper to build, and every alarm
 * clock since has kept it. Familiar beats arbitrary.
 */
export const SNOOZE_MINUTES = 9;

/** How late an alarm can be and still be worth ringing, rather than silently missed. */
export const RING_GRACE_MS = 60 * 60 * 1000;

export function snoozeUntil(now: Date, minutes: number = SNOOZE_MINUTES): Date {
  return new Date(now.getTime() + minutes * 60_000);
}

/**
 * Whether an armed alarm should be ringing right now.
 *
 * Bounded by a grace window on purpose: an alarm whose time passed while the
 * phone was off should not ambush its owner hours later. Past the window it
 * stays visible as a missed alarm instead — see `isMissed`.
 */
export function isRinging(dueAt: Date, now: Date): boolean {
  const delta = now.getTime() - dueAt.getTime();
  return delta >= 0 && delta <= RING_GRACE_MS;
}

export function isMissed(dueAt: Date, now: Date): boolean {
  return now.getTime() - dueAt.getTime() > RING_GRACE_MS;
}

/** Milliseconds until the alarm is due; negative once it has passed. */
export function msUntil(dueAt: Date, now: Date): number {
  return dueAt.getTime() - now.getTime();
}
