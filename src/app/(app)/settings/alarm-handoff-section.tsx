"use client";

import { useSyncExternalStore } from "react";
import { AlarmClockPlus } from "lucide-react";
import { supportsOsAlarmHandoff } from "@/lib/alarms/os-handoff";
import {
  IOS_SHORTCUT_NAME,
  IOS_SHORTCUT_STEPS,
  supportsIosShortcutHandoff,
} from "@/lib/alarms/ios-shortcut";

const noopSubscribe = () => () => {};
const detectOnClient = () => {
  if (supportsOsAlarmHandoff(navigator.userAgent)) return "android" as const;
  if (supportsIosShortcutHandoff(navigator.userAgent, navigator.maxTouchPoints)) {
    return "ios" as const;
  }
  return "none" as const;
};
const detectOnServer = () => "none" as const;

/**
 * Where the iPhone hand-off gets set up, because it cannot set itself up.
 *
 * Apple offers no way to install a shortcut programmatically and no way to ask
 * whether one exists, so the one-time manual step is unavoidable and belongs
 * somewhere findable. §6.1 says state a limit on the surface that carries it —
 * the alarm card says the shortcut is *needed*, and this says how to build it.
 *
 * Only rendered on a device that can actually use it. On a desktop it would be
 * instructions for a phone that isn't there.
 */
export function AlarmHandoffSection() {
  const platform = useSyncExternalStore(noopSubscribe, detectOnClient, detectOnServer);

  if (platform === "none") return null;

  if (platform === "android") {
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-card p-4 shadow-card">
        <p className="flex items-start gap-2.5 text-base text-muted-foreground">
          <AlarmClockPlus className="mt-0.5 size-4.5 shrink-0 text-cat-reminder" aria-hidden />
          <span>
            Alarms can be handed to your phone&apos;s Clock app, which rings through Do Not Disturb
            and with MeOS closed. Nothing to set up — the button appears on any alarm that has a
            time.
          </span>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-card p-4 shadow-card">
      <p className="flex items-start gap-2.5 text-base text-muted-foreground">
        <AlarmClockPlus className="mt-0.5 size-4.5 shrink-0 text-cat-reminder" aria-hidden />
        <span>
          On iPhone, no app is allowed to set a Clock alarm — not MeOS, not any app from the App
          Store. A shortcut you make yourself is the only way, and it takes about two minutes.
        </span>
      </p>

      <ol className="flex flex-col gap-2">
        {IOS_SHORTCUT_STEPS.map((step, index) => (
          <li key={step} className="flex gap-2.5 text-base">
            <span
              data-numeric
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground"
              aria-hidden
            >
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">{step}</span>
          </li>
        ))}
      </ol>

      <p className="text-sm text-muted-foreground">
        MeOS finds the shortcut by its name, so it has to be exactly{" "}
        <strong className="font-medium text-foreground">{IOS_SHORTCUT_NAME}</strong>. If tapping
        the alarm button opens Shortcuts and nothing happens, the name doesn&apos;t match.
      </p>
    </div>
  );
}
