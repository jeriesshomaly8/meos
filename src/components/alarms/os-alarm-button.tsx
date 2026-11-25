"use client";

import { useSyncExternalStore } from "react";
import { AlarmClockPlus } from "lucide-react";
import {
  OS_ALARM_HANDOFF_NOTE,
  osAlarmIntentFor,
  supportsOsAlarmHandoff,
} from "@/lib/alarms/os-handoff";
import {
  IOS_SHORTCUT_HANDOFF_NOTE,
  shortcutAlarmUrlFor,
  supportsIosShortcutHandoff,
} from "@/lib/alarms/ios-shortcut";
import { cn } from "@/lib/utils";

/**
 * Which hand-off, if any, this device can perform.
 *
 * Capability, not state: nothing to subscribe to and it never changes.
 */
type Handoff = "android" | "ios" | "none";

const noopSubscribe = () => () => {};

const detectOnClient = (): Handoff => {
  if (supportsOsAlarmHandoff(navigator.userAgent)) return "android";
  if (supportsIosShortcutHandoff(navigator.userAgent, navigator.maxTouchPoints)) return "ios";
  return "none";
};

/*
 * The server has no user agent it should trust for this, and rendering a
 * button in HTML that a desktop then hydrates would flash a dead control. So
 * the server snapshot is "none" and the button appears on the first client
 * paint — the same shape as the mic button's feature detection.
 */
const detectOnServer = (): Handoff => "none";

/**
 * "Also set my phone's alarm" — the one path that beats every limit in §9.1.
 *
 * Android hands off with an `intent://` URL to the system Clock app; iOS runs
 * a shortcut the user installed once, because Apple lets no third-party app —
 * native ones included — create a system alarm any other way.
 *
 * Renders nothing at all where neither works: an affordance that cannot work
 * is worse than none. Deliberately an anchor rather than a button, because
 * Chrome only follows an `intent://` URL from a real navigation started by a
 * user gesture.
 */
export function OsAlarmButton({
  dueAt,
  title,
  timeZone,
  className,
}: {
  dueAt: string | null;
  title: string;
  timeZone: string;
  className?: string;
}) {
  const handoff = useSyncExternalStore(noopSubscribe, detectOnClient, detectOnServer);

  const href =
    handoff === "android"
      ? osAlarmIntentFor(dueAt, timeZone, title)
      : handoff === "ios"
        ? shortcutAlarmUrlFor(dueAt, timeZone, title)
        : null;

  if (handoff === "none" || !href) return null;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <a
        href={href}
        className="flex h-13 items-center justify-center gap-2 rounded-lg bg-secondary text-body font-semibold text-secondary-foreground transition-transform duration-150 active:scale-[0.985]"
      >
        <AlarmClockPlus className="size-5" aria-hidden />
        Also set my phone&apos;s alarm
      </a>
      <p className="text-xs text-muted-foreground">
        {handoff === "android" ? OS_ALARM_HANDOFF_NOTE : IOS_SHORTCUT_HANDOFF_NOTE}
      </p>
    </div>
  );
}
