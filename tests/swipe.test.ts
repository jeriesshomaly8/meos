import { describe, expect, it } from "vitest";
import {
  COMMIT_THRESHOLD_PX,
  ENGAGE_DISTANCE_PX,
  MAX_PULL_PX,
  SHEET_DISMISS_DISTANCE_PX,
  SHEET_FLICK_DISTANCE_PX,
  SHEET_FLICK_VELOCITY,
  isHorizontalIntent,
  pullOffset,
  shouldCommit,
  shouldDismissSheet,
} from "@/lib/swipe";

/**
 * Swipe-to-complete decisions. The stakes are both directions: a swipe that
 * triggers on a scroll completes things nobody meant to complete, and a
 * scroll that gets grabbed by rows makes the list unusable.
 */

describe("horizontal intent", () => {
  it("ignores movement below the engage distance — taps and jitter", () => {
    expect(isHorizontalIntent(ENGAGE_DISTANCE_PX - 1, 0)).toBe(false);
  });

  it("engages on a clearly sideways drag", () => {
    expect(isHorizontalIntent(30, 5)).toBe(true);
    expect(isHorizontalIntent(-30, 5)).toBe(true);
  });

  it("leaves diagonal and vertical drags to the scroller", () => {
    expect(isHorizontalIntent(30, 30)).toBe(false);
    expect(isHorizontalIntent(10, 60)).toBe(false);
  });
});

describe("pull offset", () => {
  it("never pulls leftward", () => {
    expect(pullOffset(-40)).toBe(0);
  });

  it("follows the finger up to the commit point", () => {
    expect(pullOffset(40)).toBe(40);
    expect(pullOffset(COMMIT_THRESHOLD_PX)).toBe(COMMIT_THRESHOLD_PX);
  });

  it("stiffens to half-speed past the commit point and caps out", () => {
    expect(pullOffset(COMMIT_THRESHOLD_PX + 40)).toBe(COMMIT_THRESHOLD_PX + 20);
    expect(pullOffset(10_000)).toBe(MAX_PULL_PX);
  });
});

describe("commit", () => {
  it("commits exactly from the threshold", () => {
    expect(shouldCommit(COMMIT_THRESHOLD_PX - 1)).toBe(false);
    expect(shouldCommit(COMMIT_THRESHOLD_PX)).toBe(true);
  });
});

describe("sheet dismissal", () => {
  it("closes on a long deliberate pull, whatever the speed", () => {
    expect(shouldDismissSheet(SHEET_DISMISS_DISTANCE_PX, 0.01)).toBe(true);
  });

  it("closes on a genuine flick — short but fast", () => {
    expect(shouldDismissSheet(SHEET_FLICK_DISTANCE_PX, SHEET_FLICK_VELOCITY)).toBe(true);
  });

  it("ignores a twitch that happens to be quick, and a slow short pull", () => {
    expect(shouldDismissSheet(SHEET_FLICK_DISTANCE_PX - 1, 5)).toBe(false);
    expect(shouldDismissSheet(SHEET_DISMISS_DISTANCE_PX - 1, 0.1)).toBe(false);
  });
});
