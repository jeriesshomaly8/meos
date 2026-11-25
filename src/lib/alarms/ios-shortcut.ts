import { osAlarmFields, type OsAlarmFields } from "./os-handoff";

/**
 * Handing an alarm to the iPhone's Clock app, the only way iOS allows.
 *
 * **No third-party app can create a system alarm on iOS.** Not a web app, not
 * a native app from the App Store — Apple exposes no API for it, and only the
 * built-in Clock app may. Everything else an app can do is a *notification*,
 * which Do Not Disturb and Focus silence by design. That is the wall §9.1
 * describes, and this module is the one route around it.
 *
 * Shortcuts can create a real alarm, and a shortcut can be launched from a URL.
 * So MeOS deep-links into a shortcut the user installs once, by hand, and that
 * shortcut sets the alarm. The hand-off is fire-and-forget in exactly the way
 * the Android one is: no id comes back, so MeOS can never change or cancel it.
 *
 * The part that cannot be engineered away: **Apple provides no way to install
 * a shortcut programmatically**, and no way to ask whether one exists. Tapping
 * the button when the shortcut is missing opens the Shortcuts app and does
 * nothing else, which is why the copy says what to expect before the tap
 * rather than after it.
 */

/**
 * The name the user's shortcut must have, character for character.
 *
 * Shortcuts are addressed by display name — there is no id — so this string is
 * a contract with something living on the user's phone. Changing it silently
 * breaks every shortcut already installed, which is why it is declared once
 * here and read by both the URL builder and the setup instructions.
 */
export const IOS_SHORTCUT_NAME = "MeOS Alarm";

/**
 * Stated wherever the button appears. Three surprises, all of which land after
 * the tap: the one-time setup, the generic label, and no take-backs.
 */
export const IOS_SHORTCUT_HANDOFF_NOTE =
  "Sets a real alarm in the Clock app, which rings through Do Not Disturb and Focus. Needs the “MeOS Alarm” shortcut installed once — set it up in Settings. MeOS can't change or cancel the alarm afterwards.";

/** Shown where the shortcut is set up, so the user knows what they are building. */
export const IOS_SHORTCUT_STEPS = [
  "Open the Shortcuts app and tap + to make a new shortcut.",
  "Add the action “Create Alarm”.",
  "Set its time to the Shortcut Input, and leave the label as you like it.",
  `Rename the shortcut to exactly “${IOS_SHORTCUT_NAME}” — the name is how MeOS finds it.`,
] as const;

/**
 * `HH:MM`, zero-padded, 24-hour.
 *
 * The whole payload is a time and nothing else. A richer format — a label, a
 * date — would need the user to add Split Text actions to a shortcut they are
 * building by hand from written instructions, and every extra step is another
 * place for the setup to fail silently. The cost is that every MeOS alarm
 * carries whatever label the shortcut hardcodes; that limit is in the copy.
 */
export function shortcutTimePayload(fields: OsAlarmFields): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(fields.hour)}:${pad(fields.minute)}`;
}

/**
 * A `shortcuts://` URL that runs the user's shortcut with the time as input.
 *
 * Null rather than a throw on bad input, so a caller hides the button instead
 * of catching — same contract as `buildSetAlarmIntent`.
 */
export function buildShortcutAlarmUrl(fields: OsAlarmFields): string | null {
  const { hour, minute } = fields;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;

  const params = new URLSearchParams({
    name: IOS_SHORTCUT_NAME,
    input: "text",
    text: shortcutTimePayload(fields),
  });
  return `shortcuts://run-shortcut?${params.toString()}`;
}

/** Convenience for the surfaces that hold an instant and a title. */
export function shortcutAlarmUrlFor(
  dueAt: string | null,
  timeZone: string,
  title: string,
): string | null {
  const fields = osAlarmFields(dueAt, timeZone, title);
  return fields ? buildShortcutAlarmUrl(fields) : null;
}

/**
 * Whether this device can run a shortcut.
 *
 * Every browser on iOS is WebKit and all of them follow `shortcuts://`, so the
 * test is the platform rather than the browser — the opposite of the Android
 * check, where the platform is right and Firefox still refuses.
 *
 * `maxTouchPoints` is passed in because iPadOS 13+ reports a *Macintosh* user
 * agent; the touch count is what separates an iPad from a Mac, and a Mac has
 * no Clock app to hand an alarm to.
 */
export function supportsIosShortcutHandoff(userAgent: string, maxTouchPoints = 0): boolean {
  if (/iphone|ipod|ipad/i.test(userAgent)) return true;
  if (/macintosh|mac os x/i.test(userAgent) && maxTouchPoints > 1) return true;
  return false;
}
