"use client";

import { useEffect } from "react";
import { registerPushServiceWorker } from "@/lib/push/client";

/**
 * Registers the push service worker on every app load. Registration is
 * idempotent and also how the browser notices an updated sw.js, so an install
 * that subscribed months ago keeps receiving alarms after the worker changes.
 *
 * This never asks for notification permission — that only happens from the
 * explicit flow in Settings → Alarms. Renders nothing, like AlarmScheduler.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    void registerPushServiceWorker();
  }, []);

  return null;
}
