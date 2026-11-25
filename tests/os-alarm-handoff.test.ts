import { describe, expect, it } from "vitest";
import {
  buildSetAlarmIntent,
  osAlarmFields,
  osAlarmIntentFor,
  supportsOsAlarmHandoff,
} from "@/lib/alarms/os-handoff";

/**
 * §6.3 A. The deterministic half of the hand-off: the URL MeOS builds and the
 * browsers it offers it to. The half that cannot be tested here is whether the
 * Clock app actually rang, which is Phase 10 and needs a real phone.
 */

const TZ = "Asia/Jerusalem";
/** 07:00 on 11 Aug 2026 in Jerusalem — the plan's worked example. */
const SEVEN_AM_LOCAL = "2026-08-11T04:00:00.000Z";

const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const SAMSUNG_ANDROID =
  "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36";
const FIREFOX_ANDROID = "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

describe("reading the clock face off an instant", () => {
  it("uses the user's zone, not the machine's", () => {
    expect(osAlarmFields(SEVEN_AM_LOCAL, TZ, "Wake up")).toEqual({
      hour: 7,
      minute: 0,
      message: "Wake up",
    });
    // The same instant is 04:00 in UTC. Handing that to the Clock app would
    // set an alarm three hours early — the §1.6 bug, in a new place.
    expect(osAlarmFields(SEVEN_AM_LOCAL, "UTC", "Wake up")?.hour).toBe(4);
  });

  it("falls back to a label rather than an empty alarm name", () => {
    expect(osAlarmFields(SEVEN_AM_LOCAL, TZ, "   ")?.message).toBe("Alarm");
  });

  it("has nothing to hand off without a time", () => {
    expect(osAlarmFields(null, TZ, "Wake up")).toBeNull();
    expect(osAlarmFields("not a date", TZ, "Wake up")).toBeNull();
  });
});

describe("the intent URL", () => {
  const url = osAlarmIntentFor(SEVEN_AM_LOCAL, TZ, "Wake up");

  it("asks Android for a real alarm at the right time", () => {
    expect(url).toBe(
      "intent://#Intent;action=android.intent.action.SET_ALARM;" +
        "i.android.intent.extra.alarm.HOUR=7;" +
        "i.android.intent.extra.alarm.MINUTES=0;" +
        "S.android.intent.extra.alarm.MESSAGE=Wake%20up;" +
        "B.android.intent.extra.alarm.SKIP_UI=false;end",
    );
  });

  it("encodes a title that would otherwise truncate the intent", () => {
    // A semicolon ends an extra and a hash starts the fragment: unencoded,
    // either one silently cuts the alarm's time off the end of the URL.
    const built = buildSetAlarmIntent({ hour: 6, minute: 45, message: "Gym; then #standup" });
    expect(built).toContain("MESSAGE=Gym%3B%20then%20%23standup");
    expect(built).toContain("i.android.intent.extra.alarm.MINUTES=45");
    // Exactly one extras separator per field — nothing leaked out of the value.
    expect(built?.split(";")).toHaveLength(7);
  });

  it("refuses impossible clock readings instead of building a broken URL", () => {
    expect(buildSetAlarmIntent({ hour: 24, minute: 0, message: "x" })).toBeNull();
    expect(buildSetAlarmIntent({ hour: 7, minute: 60, message: "x" })).toBeNull();
    expect(buildSetAlarmIntent({ hour: 7.5, minute: 0, message: "x" })).toBeNull();
  });
});

describe("where the button is offered", () => {
  it("appears on Android browsers that follow intent:// URLs", () => {
    expect(supportsOsAlarmHandoff(CHROME_ANDROID)).toBe(true);
    expect(supportsOsAlarmHandoff(SAMSUNG_ANDROID)).toBe(true);
  });

  it("stays hidden where the URL would do nothing", () => {
    expect(supportsOsAlarmHandoff(FIREFOX_ANDROID)).toBe(false);
    expect(supportsOsAlarmHandoff(IPHONE_SAFARI)).toBe(false);
    expect(supportsOsAlarmHandoff(DESKTOP_CHROME)).toBe(false);
    expect(supportsOsAlarmHandoff("")).toBe(false);
  });
});
