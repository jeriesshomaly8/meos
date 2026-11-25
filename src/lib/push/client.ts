"use client";

/**
 * The browser half of §6.3 C: registering the service worker, asking for
 * notification permission, and keeping the server's copy of this device's
 * subscription current.
 *
 * The permission prompt is never fired on page load. `enablePushAlarms()` runs
 * from an explicit tap in Settings, after copy that says what the device will
 * actually do — a prompt that arrives before the explanation is the pattern
 * that gets reflex-denied, and a denial is close to permanent on the web.
 */

export type PushStatus =
  /** This browser has no push machinery at all. */
  | { kind: "unsupported" }
  /** iPhone/iPad in the browser: iOS only delivers web push to an installed app. */
  | { kind: "needs-install" }
  /** The deployment has no VAPID key baked in — a server problem, not a device one. */
  | { kind: "not-configured" }
  /** The user has blocked notifications for MeOS; only they can unblock. */
  | { kind: "denied" }
  /** Supported and allowed (or not yet asked), but this device isn't subscribed. */
  | { kind: "off" }
  /** This device is subscribed and the server knows about it. */
  | { kind: "on" };

/** Everything classification needs, gathered in one place so tests can fake it. */
export interface PushEnvironment {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  permission: NotificationPermission | null;
  isIosDevice: boolean;
  standalone: boolean;
  hasVapidKey: boolean;
}

/**
 * The synchronous part of the answer — everything except whether a
 * subscription actually exists, which only the registration can say.
 */
export function classifyPushSupport(
  env: PushEnvironment,
): "unsupported" | "needs-install" | "not-configured" | "denied" | "available" {
  const hasMachinery = env.hasServiceWorker && env.hasPushManager && env.hasNotification;
  if (!hasMachinery) {
    // On an iPhone the machinery appears once the app is installed to the
    // home screen (iOS 16.4+), so the honest state is an instruction, not a
    // shrug.
    return env.isIosDevice && !env.standalone ? "needs-install" : "unsupported";
  }
  if (!env.hasVapidKey) return "not-configured";
  if (env.permission === "denied") return "denied";
  return "available";
}

export function readPushEnvironment(): PushEnvironment {
  return {
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
    permission: "Notification" in window ? Notification.permission : null,
    // Same platform test as the alarm hand-off: iPadOS 13+ reports a
    // Macintosh user agent, and the touch count is what gives it away.
    isIosDevice:
      /iphone|ipod|ipad/i.test(navigator.userAgent) ||
      (/macintosh|mac os x/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1),
    standalone: window.matchMedia("(display-mode: standalone)").matches,
    hasVapidKey: Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
  };
}

/**
 * `PushManager.subscribe` wants the VAPID key as bytes, and the env var is the
 * base64url string `web-push generate-vapid-keys` printed.
 */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), "=");
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Idempotent, safe to call on every app load: registering an already-registered
 * worker is a no-op that also checks for an updated sw.js.
 */
export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    // A failed registration only matters when the user tries to enable push,
    // and enablePushAlarms() will surface it then.
    return null;
  }
}

export async function currentPushStatus(): Promise<PushStatus> {
  const support = classifyPushSupport(readPushEnvironment());
  if (support !== "available") return { kind: support };

  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return { kind: subscription ? "on" : "off" };
}

export type EnableResult = PushStatus | { kind: "error"; message: string };

export async function enablePushAlarms(): Promise<EnableResult> {
  const support = classifyPushSupport(readPushEnvironment());
  if (support !== "available") return { kind: support };

  const registration = await registerPushServiceWorker();
  if (!registration) {
    return { kind: "error", message: "This browser refused the notification worker." };
  }

  const permission = await Notification.requestPermission();
  // "default" is a dismissed prompt, not a decision — the button stays and
  // the user can try again. Only an actual block gets the blocked copy.
  if (permission === "default") return { kind: "off" };
  if (permission !== "granted") return { kind: "denied" };

  let subscription: PushSubscription;
  try {
    subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string,
        ),
      }));
  } catch {
    return { kind: "error", message: "The push service wouldn't register this device." };
  }

  // Roll back on ANY failure to tell the server, including the fetch itself
  // rejecting mid-flight: a subscription the server never learned about would
  // report "on" forever while nothing could ever be delivered to it.
  try {
    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
    if (!response.ok) throw new Error(`subscribe returned ${response.status}`);
  } catch {
    await subscription.unsubscribe().catch(() => {});
    return { kind: "error", message: "Couldn't save this device for alarms. Try again." };
  }

  return { kind: "on" };
}

export async function disablePushAlarms(): Promise<PushStatus> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return { kind: "off" };

  // Tell the server first: if the network drops midway, a subscription that
  // still exists but has no row simply receives nothing — the safe half.
  await fetch("/api/push/subscribe", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => {});
  await subscription.unsubscribe().catch(() => {});

  return { kind: "off" };
}
