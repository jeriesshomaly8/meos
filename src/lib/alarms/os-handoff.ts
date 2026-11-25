import { partsInZone } from "@/lib/temporal/zone";

/**
 * Handing an alarm to the phone's own clock app.
 *
 * §6.1 of the v2 plan: hand the job to the operating system rather than
 * reimplementing it. Every limit in §9.1 — Do Not Disturb, Doze, connectivity,
 * iOS Critical Alerts — applies to a notification and to none of them applies
 * to a real OS alarm. Chrome on Android will follow an `intent://` URL after a
 * user tap and the system Clock app sets a genuine alarm that survives a
 * closed browser, a dead network and airplane mode.
 *
 * What this cannot do, and why the copy below says so:
 *   * `ACTION_SET_ALARM` takes an hour and a minute, never a date. The clock
 *     app rings at the next occurrence of that time, so an alarm set for next
 *     Tuesday hands off as "07:00", which is tomorrow.
 *   * It is fire-and-forget. MeOS gets no id back, so it can never read the
 *     alarm, change it, or cancel it — snoozing here does not snooze there.
 *   * Android only. There is no iOS equivalent short of a Shortcut the user
 *     installs by hand (§6.2 B).
 */

/** The extras namespace `AlarmClock` reads. Written out once. */
const ALARM_EXTRA = "android.intent.extra.alarm";

/** Clock apps show this as the alarm's label; long titles get cut off anyway. */
const MAX_MESSAGE_CHARS = 60;

/**
 * Stated on every surface that offers the hand-off, because the two
 * surprises — no date, no take-backs — both bite after the tap.
 */
export const OS_ALARM_HANDOFF_NOTE =
  "Sets a real alarm in your phone's Clock app, which rings through Do Not Disturb and with MeOS closed. The Clock app only takes a time, so it rings at the next one — and MeOS can't change or cancel it afterwards.";

export interface OsAlarmFields {
  /** 0–23, in the zone the alarm was set for. */
  hour: number;
  /** 0–59. */
  minute: number;
  message: string;
}

/**
 * The clock-face reading of an instant.
 *
 * Goes through `partsInZone` for the §1.6 reason: `getHours()` would read the
 * *device's* zone, which is the server's on a render and the traveller's after
 * a flight. An alarm set for 07:00 in Jerusalem hands off as 07:00.
 */
export function osAlarmFields(
  dueAt: string | null,
  timeZone: string,
  title: string,
): OsAlarmFields | null {
  if (!dueAt) return null;
  const instant = new Date(dueAt);
  if (Number.isNaN(instant.getTime())) return null;

  const parts = partsInZone(instant, timeZone);
  const message = title.trim().slice(0, MAX_MESSAGE_CHARS) || "Alarm";
  return { hour: parts.hour, minute: parts.minute, message };
}

/**
 * An `intent://` URL that opens the system Clock app with the alarm prefilled.
 *
 * Extras are percent-encoded because `Intent.parseUri` splits the fragment on
 * `;` and then `Uri.decode`s each value: an unencoded semicolon or hash in an
 * alarm title would truncate the intent, and `Uri.decode` leaves `+` as a
 * literal plus, so `encodeURIComponent` is exactly the right encoder.
 *
 * Returns null rather than throwing on nonsense input, so a caller can use the
 * null to hide the button instead of catching.
 */
export function buildSetAlarmIntent(fields: OsAlarmFields): string | null {
  const { hour, minute, message } = fields;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;

  const label = message.trim().slice(0, MAX_MESSAGE_CHARS) || "Alarm";

  return [
    "intent://#Intent",
    "action=android.intent.action.SET_ALARM",
    `i.${ALARM_EXTRA}.HOUR=${hour}`,
    `i.${ALARM_EXTRA}.MINUTES=${minute}`,
    `S.${ALARM_EXTRA}.MESSAGE=${encodeURIComponent(label)}`,
    // SKIP_UI false on purpose: the Clock app opens and shows what it just
    // set. A silent hand-off looks identical to a hand-off that failed.
    `B.${ALARM_EXTRA}.SKIP_UI=false`,
    "end",
  ].join(";");
}

/** Convenience for the two surfaces that have an instant and a title. */
export function osAlarmIntentFor(
  dueAt: string | null,
  timeZone: string,
  title: string,
): string | null {
  const fields = osAlarmFields(dueAt, timeZone, title);
  return fields ? buildSetAlarmIntent(fields) : null;
}

/**
 * Whether this browser will follow an `intent://` URL.
 *
 * Chrome, Edge, Samsung Internet and every other Chromium shell on Android
 * will; Firefox for Android will not, and desktop Chrome will not. Same rule
 * as the mic button: where it cannot work, the control is absent rather than
 * disabled, so nothing on screen promises something that will not happen.
 */
export function supportsOsAlarmHandoff(userAgent: string): boolean {
  if (!/android/i.test(userAgent)) return false;
  // Firefox for Android ignores intent:// entirely and shows a dead link.
  if (/firefox|fxios/i.test(userAgent)) return false;
  return true;
}
