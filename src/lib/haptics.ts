/**
 * Haptic feedback, where the platform allows it (Android Chrome; iOS ignores
 * `navigator.vibrate` and that is fine — silence, not an error).
 *
 * Two patterns only. A tick is a single short tap; finishing something whole
 * (an alarm silenced, a list completed) gets a double tap. More vocabulary
 * than that and the hand stops being able to read it.
 */

function vibrate(pattern: number | number[]) {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  navigator.vibrate(pattern);
}

/** One short tap — ticking a row or a list line. */
export function tapHaptic() {
  vibrate(10);
}

/** Two taps — something finished: alarm dismissed, whole item done. */
export function doneHaptic() {
  vibrate([15, 60, 20]);
}
