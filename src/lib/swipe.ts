/**
 * The arithmetic of swipe-to-complete, kept pure so the decisions are
 * testable: when a drag counts as a horizontal swipe rather than a scroll,
 * how far the row follows the finger, and when releasing commits the action.
 *
 * The component layer owns pointers and rendering; nothing here touches the
 * DOM.
 */

/** Movement below this is a tap or scroll jitter, not intent. */
export const ENGAGE_DISTANCE_PX = 14;

/** How far the row can follow the finger. */
export const MAX_PULL_PX = 112;

/** Releasing past this commits the action. */
export const COMMIT_THRESHOLD_PX = 72;

/**
 * Whether a drag has declared itself horizontal. Vertical-or-diagonal drags
 * must stay scrolls: a list you cannot scroll because every row grabs the
 * touch is worse than no swipe at all.
 */
export function isHorizontalIntent(dx: number, dy: number): boolean {
  return Math.abs(dx) >= ENGAGE_DISTANCE_PX && Math.abs(dx) > Math.abs(dy) * 1.5;
}

/**
 * The row's offset while dragging: rightward only, and past the commit point
 * it stiffens to half-speed so the gesture reads as "held", not "thrown".
 */
export function pullOffset(dx: number): number {
  if (dx <= 0) return 0;
  const soft = Math.min(dx, COMMIT_THRESHOLD_PX);
  const overshoot = Math.max(0, dx - COMMIT_THRESHOLD_PX) / 2;
  return Math.min(soft + overshoot, MAX_PULL_PX);
}

/** Whether releasing at this offset performs the action. */
export function shouldCommit(offset: number): boolean {
  return offset >= COMMIT_THRESHOLD_PX;
}

/* ---- sheet dismissal: the same idea, vertical ------------------------------ */

/** A slow deliberate pull past this closes the sheet. */
export const SHEET_DISMISS_DISTANCE_PX = 110;

/** A flick: shorter, but fast. px per ms. */
export const SHEET_FLICK_VELOCITY = 0.55;
export const SHEET_FLICK_DISTANCE_PX = 40;

/**
 * Whether releasing a downward drag closes the sheet. Two honest ways in: a
 * long pull, or a genuine flick — a tiny twitch that happens to be quick
 * closes nothing, which is what keeps scroll-adjacent gestures safe.
 */
export function shouldDismissSheet(dy: number, velocity: number): boolean {
  if (dy >= SHEET_DISMISS_DISTANCE_PX) return true;
  return dy >= SHEET_FLICK_DISTANCE_PX && velocity >= SHEET_FLICK_VELOCITY;
}
