"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  currentPushStatus,
  disablePushAlarms,
  enablePushAlarms,
  type PushStatus,
} from "@/lib/push/client";

/**
 * Where push alarms get turned on, and the only place the permission prompt
 * can be triggered from. The copy above the button is the §9.1 honesty rule:
 * a push is a notification, so it says what a notification cannot do *before*
 * the browser asks anything.
 */

type SectionState = { kind: "loading" } | { kind: "error"; message: string } | PushStatus;

const HONEST_LIMIT =
  "It's a notification: Do Not Disturb silences it, and the phone needs a connection when the alarm fires. Keep your usual alarm for anything you can't miss.";

export function PushAlarmsSection() {
  const [state, setState] = useState<SectionState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void currentPushStatus().then((status) => {
      if (!cancelled) setState(status);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = async () => {
    setBusy(true);
    const result = await enablePushAlarms();
    setState(result);
    setBusy(false);
  };

  const disable = async () => {
    setBusy(true);
    setState(await disablePushAlarms());
    setBusy(false);
  };

  if (state.kind === "loading") return null;

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-card p-4 shadow-card">
      <p className="flex items-start gap-2.5 text-base text-muted-foreground">
        <BellRing className="mt-0.5 size-4.5 shrink-0 text-cat-reminder" aria-hidden />
        <Body state={state} />
      </p>

      {(state.kind === "off" || state.kind === "error") && (
        <Button variant="outline" size="sm" className="self-start" onClick={enable} disabled={busy}>
          {busy ? "Turning on…" : "Nudge this device when an alarm rings"}
        </Button>
      )}

      {state.kind === "on" && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={disable}
          disabled={busy}
        >
          {busy ? "Turning off…" : "Stop nudging this device"}
        </Button>
      )}
    </div>
  );
}

/** One honest sentence per state — the states are the feature. */
function Body({ state }: { state: SectionState }) {
  switch (state.kind) {
    case "off":
      return (
        <span>
          MeOS can nudge this device when an alarm goes off, even with the app closed.{" "}
          {HONEST_LIMIT}
        </span>
      );
    case "on":
      return (
        <span aria-live="polite">
          This device gets nudged when an alarm rings, repeating for five minutes until you open
          it. {HONEST_LIMIT}
        </span>
      );
    case "needs-install":
      return (
        <span>
          iPhones only deliver web notifications to installed apps. Add MeOS to your Home Screen
          first — Share button, then &ldquo;Add to Home Screen&rdquo; — and this option appears.
        </span>
      );
    case "denied":
      return (
        <span>
          Notifications for MeOS are blocked, so alarms can&apos;t nudge this device. Allow
          notifications for this site in your browser&apos;s settings, then come back here.
        </span>
      );
    case "unsupported":
      return (
        <span>
          This browser can&apos;t receive push notifications, so alarms only ring while MeOS is
          open here.
        </span>
      );
    case "not-configured":
      return (
        <span>
          This server isn&apos;t set up to send push notifications — nothing you can fix from this
          device. Alarms still ring while MeOS is open.
        </span>
      );
    case "error":
      return <span aria-live="polite">{state.message}</span>;
    default:
      return null;
  }
}
