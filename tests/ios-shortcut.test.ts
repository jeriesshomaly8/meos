import { describe, expect, it } from "vitest";
import {
  buildShortcutAlarmUrl,
  IOS_SHORTCUT_NAME,
  shortcutAlarmUrlFor,
  shortcutTimePayload,
  supportsIosShortcutHandoff,
} from "@/lib/alarms/ios-shortcut";
import { osAlarmFields } from "@/lib/alarms/os-handoff";

/**
 * §6.3 B — the iPhone alarm hand-off.
 *
 * Everything here is the URL and the platform test, which are pure. What no
 * test can prove is that a shortcut exists on the user's phone, or that iOS
 * ran it: Apple offers no way to install one programmatically and no way to
 * ask whether one is installed. That half is Phase 10 and needs a thumb.
 */

const TZ = "Asia/Jerusalem";

describe("shortcutTimePayload", () => {
  it("zero-pads to a 24-hour clock", () => {
    expect(shortcutTimePayload({ hour: 7, minute: 0, message: "Wake up" })).toBe("07:00");
    expect(shortcutTimePayload({ hour: 23, minute: 5, message: "x" })).toBe("23:05");
    expect(shortcutTimePayload({ hour: 0, minute: 0, message: "x" })).toBe("00:00");
  });
});

describe("buildShortcutAlarmUrl", () => {
  it("names the shortcut and passes the time as text input", () => {
    const url = buildShortcutAlarmUrl({ hour: 7, minute: 30, message: "Wake up" });
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.protocol).toBe("shortcuts:");
    expect(parsed.searchParams.get("name")).toBe(IOS_SHORTCUT_NAME);
    expect(parsed.searchParams.get("input")).toBe("text");
    expect(parsed.searchParams.get("text")).toBe("07:30");
  });

  /*
   * The shortcut is addressed by display name, so the name has to survive the
   * URL intact — a raw space here is what would make iOS fail to find it.
   */
  it("encodes the shortcut name, which contains a space", () => {
    const url = buildShortcutAlarmUrl({ hour: 7, minute: 0, message: "x" })!;
    expect(url).toContain("name=MeOS+Alarm");
    expect(new URL(url).searchParams.get("name")).toBe("MeOS Alarm");
  });

  it("refuses a time that is not a real clock reading", () => {
    expect(buildShortcutAlarmUrl({ hour: 24, minute: 0, message: "x" })).toBeNull();
    expect(buildShortcutAlarmUrl({ hour: -1, minute: 0, message: "x" })).toBeNull();
    expect(buildShortcutAlarmUrl({ hour: 7, minute: 60, message: "x" })).toBeNull();
    expect(buildShortcutAlarmUrl({ hour: 7.5, minute: 0, message: "x" })).toBeNull();
  });
});

describe("shortcutAlarmUrlFor", () => {
  /*
   * The §1.6 rule. 04:00 UTC is 07:00 in Jerusalem, and the alarm was set for
   * seven in the morning where the user is — not where the server is.
   */
  it("hands off the clock face in the user's zone, not the server's", () => {
    const url = shortcutAlarmUrlFor("2026-08-11T04:00:00Z", TZ, "Wake up")!;
    expect(new URL(url).searchParams.get("text")).toBe("07:00");
    expect(new URL(shortcutAlarmUrlFor("2026-08-11T04:00:00Z", "UTC", "Wake up")!).searchParams.get("text")).toBe(
      "04:00",
    );
  });

  it("is null with no instant, so the button hides instead of lying", () => {
    expect(shortcutAlarmUrlFor(null, TZ, "Wake up")).toBeNull();
    expect(shortcutAlarmUrlFor("not a date", TZ, "Wake up")).toBeNull();
  });

  it("agrees with the Android hand-off about what time it is", () => {
    const fields = osAlarmFields("2026-08-11T04:00:00Z", TZ, "Wake up")!;
    expect(shortcutTimePayload(fields)).toBe("07:00");
  });
});

describe("supportsIosShortcutHandoff", () => {
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
  const MAC =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
  const ANDROID =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

  it("says yes on an iPhone", () => {
    expect(supportsIosShortcutHandoff(IPHONE)).toBe(true);
  });

  /*
   * iPadOS 13+ reports a Macintosh user agent. Touch points are what separate
   * an iPad from a Mac, and a Mac has no Clock app to hand an alarm to.
   */
  it("tells an iPad apart from a Mac by its touch points", () => {
    expect(supportsIosShortcutHandoff(MAC, 5)).toBe(true);
    expect(supportsIosShortcutHandoff(MAC, 0)).toBe(false);
  });

  it("says no on Android, which has its own hand-off", () => {
    expect(supportsIosShortcutHandoff(ANDROID)).toBe(false);
  });
});
