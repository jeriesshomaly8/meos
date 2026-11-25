import { describe, expect, it } from "vitest";
import {
  ESCALATION_INTERVAL_S,
  ESCALATION_WINDOW_S,
  MAX_ATTEMPT,
  alarmPushPayload,
  attemptNumber,
  escalationPhase,
  pushTopic,
  subscriptionFate,
} from "@/lib/push/escalation";
import { authorizedByCronSecret } from "@/lib/push/cron-auth";
import { classifyPushSupport, urlBase64ToUint8Array, type PushEnvironment } from "@/lib/push/client";

/**
 * The §9.2 escalation stop conditions, testable because the arithmetic is
 * mirrored out of `due_alarm_pushes()` into pure functions. What cannot be
 * tested here is the SQL itself or whether a phone chimes — the first is
 * pinned by running the migration, the second is Phase 10.
 */

const DUE = new Date("2026-08-14T04:00:00Z"); // "tomorrow at 7am" in Jerusalem

function secondsAfter(seconds: number): Date {
  return new Date(DUE.getTime() + seconds * 1000);
}

describe("escalation attempts", () => {
  it("starts at attempt 0 the moment the alarm is due", () => {
    expect(attemptNumber(DUE, DUE)).toBe(0);
  });

  it("advances one attempt per interval, on the boundary exactly", () => {
    expect(attemptNumber(DUE, secondsAfter(ESCALATION_INTERVAL_S - 1))).toBe(0);
    expect(attemptNumber(DUE, secondsAfter(ESCALATION_INTERVAL_S))).toBe(1);
    expect(attemptNumber(DUE, secondsAfter(2 * ESCALATION_INTERVAL_S))).toBe(2);
  });

  it("caps at fifteen attempts inside the five-minute window", () => {
    // One chime is missable; sixteen is an alarm — but not an endless one.
    expect(MAX_ATTEMPT).toBe(14);
    expect(attemptNumber(DUE, secondsAfter(ESCALATION_WINDOW_S - 1))).toBe(MAX_ATTEMPT);
  });
});

describe("escalation stop conditions", () => {
  it("does not start before the alarm is due", () => {
    expect(escalationPhase(DUE, secondsAfter(-1))).toBe("pending");
  });

  it("escalates from the due instant to the end of the window", () => {
    expect(escalationPhase(DUE, DUE)).toBe("escalating");
    expect(escalationPhase(DUE, secondsAfter(ESCALATION_WINDOW_S - 1))).toBe("escalating");
  });

  it("stops at exactly the window boundary — a late push must not ambush anyone", () => {
    expect(escalationPhase(DUE, secondsAfter(ESCALATION_WINDOW_S))).toBe("lapsed");
    expect(escalationPhase(DUE, secondsAfter(ESCALATION_WINDOW_S * 10))).toBe("lapsed");
  });

  /*
   * The other two stop conditions live in the database query, not in
   * arithmetic: dismissing sets `status = 'done'` and `due_alarm_pushes()`
   * only selects `active`; snoozing moves `due_at` forward, which this phase
   * function reads as "pending" again.
   */
  it("treats a snoozed alarm as pending, so the nag stops until it is due again", () => {
    const snoozedTo = new Date(DUE.getTime() + 9 * 60_000);
    expect(escalationPhase(snoozedTo, secondsAfter(60))).toBe("pending");
  });
});

describe("subscription fate on push-service errors", () => {
  it("drops the row when the service says the endpoint is gone", () => {
    expect(subscriptionFate(404)).toBe("dead");
    expect(subscriptionFate(410)).toBe("dead");
  });

  it("keeps the row on a bad moment — rate limits, outages, no network", () => {
    expect(subscriptionFate(429)).toBe("transient");
    expect(subscriptionFate(500)).toBe("transient");
    expect(subscriptionFate(502)).toBe("transient");
    expect(subscriptionFate(undefined)).toBe("transient");
  });
});

describe("push payload", () => {
  it("collapses to a topic the push spec allows: 32 base64url characters", () => {
    const topic = pushTopic("0b7e91c4-52a3-4a6e-9d0f-3c2b1a09f8e7");
    expect(topic).toHaveLength(32);
    expect(topic).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("carries what sw.js reads, and never an empty title", () => {
    expect(alarmPushPayload("id-1", "  Wake up  ")).toMatchObject({
      title: "Wake up",
      itemId: "id-1",
      kind: "alarm",
    });
    expect(alarmPushPayload("id-1", null).title).toBe("Alarm");
    expect(alarmPushPayload("id-1", "   ").title).toBe("Alarm");
  });
});

describe("cron authentication", () => {
  it("accepts exactly the configured secret as a bearer token", () => {
    expect(authorizedByCronSecret("Bearer s3cret", "s3cret")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(authorizedByCronSecret("Bearer wrong", "s3cret")).toBe(false);
    expect(authorizedByCronSecret("s3cret", "s3cret")).toBe(false);
    expect(authorizedByCronSecret(null, "s3cret")).toBe(false);
    expect(authorizedByCronSecret("Bearer s3cret2", "s3cret")).toBe(false);
  });

  it("fails closed when the server has no secret configured", () => {
    expect(authorizedByCronSecret("Bearer anything", undefined)).toBe(false);
    expect(authorizedByCronSecret("Bearer ", "")).toBe(false);
  });
});

describe("VAPID key decoding", () => {
  it("decodes base64url, including the two characters plain base64 lacks", () => {
    expect(Array.from(urlBase64ToUint8Array("AQID"))).toEqual([1, 2, 3]);
    expect(Array.from(urlBase64ToUint8Array("_w"))).toEqual([255]);
    expect(Array.from(urlBase64ToUint8Array("--8"))).toEqual([251, 239]);
  });
});

describe("push support classification", () => {
  const supported: PushEnvironment = {
    hasServiceWorker: true,
    hasPushManager: true,
    hasNotification: true,
    permission: "default",
    isIosDevice: false,
    standalone: false,
    hasVapidKey: true,
  };

  it("is available with the machinery present, before permission was ever asked", () => {
    expect(classifyPushSupport(supported)).toBe("available");
    expect(classifyPushSupport({ ...supported, permission: "granted" })).toBe("available");
  });

  it("tells an iPhone in the browser to install, not that push is impossible", () => {
    const iosSafari = {
      ...supported,
      hasPushManager: false,
      isIosDevice: true,
    };
    expect(classifyPushSupport(iosSafari)).toBe("needs-install");
    // Installed and still no machinery: an old iOS, and installing again
    // would change nothing — that one is honestly unsupported.
    expect(classifyPushSupport({ ...iosSafari, standalone: true })).toBe("unsupported");
  });

  it("is unsupported without the machinery anywhere else", () => {
    expect(classifyPushSupport({ ...supported, hasServiceWorker: false })).toBe("unsupported");
  });

  it("blames the server, not the device, when the VAPID key is missing", () => {
    expect(classifyPushSupport({ ...supported, hasVapidKey: false })).toBe("not-configured");
  });

  it("respects a denial — only the user can unblock it", () => {
    expect(classifyPushSupport({ ...supported, permission: "denied" })).toBe("denied");
  });
});
