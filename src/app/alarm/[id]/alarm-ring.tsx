"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlarmClock, BellOff, Loader2, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { setItemDone, snoozeAlarm } from "@/app/(app)/actions";
import { SNOOZE_MINUTES, isMissed, isRinging, msUntil } from "@/lib/alarms/snooze";
import { doneHaptic, tapHaptic } from "@/lib/haptics";
import { dueLabel } from "@/lib/items/rows";
import { browserTimeZone } from "@/lib/temporal/inputs";
import { useAlarmRing } from "@/lib/alarms/use-ring";
import { cn } from "@/lib/utils";
import { OsAlarmButton } from "@/components/alarms/os-alarm-button";

interface AlarmRingProps {
  id: string;
  title: string;
  dueAt: string;
  dismissed: boolean;
  snoozeCount: number;
  timeZone: string;
}

type Phase = "ringing" | "waiting" | "missed" | "dismissed";

function phaseOf(dueAt: Date, now: Date, dismissed: boolean): Phase {
  if (dismissed) return "dismissed";
  if (isRinging(dueAt, now)) return "ringing";
  if (isMissed(dueAt, now)) return "missed";
  return "waiting";
}

function countdown(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 1) return "less than a minute";
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/**
 * The screen a ringing alarm takes over.
 *
 * It renders four states rather than assuming it was opened on time, because
 * the notification that opens it can be tapped minutes late, hours late, or
 * after the alarm was already dismissed on another device.
 */
export function AlarmRing({
  id,
  title,
  dueAt,
  dismissed,
  snoozeCount,
  timeZone,
}: AlarmRingProps) {
  const router = useRouter();
  const due = new Date(dueAt);
  const [now, setNow] = useState(() => new Date());
  const [pending, startTransition] = useTransition();
  const { state: ringState, start, stop } = useAlarmRing();

  const phase = phaseOf(due, now, dismissed);

  // One second is the only tick rate at which a countdown and the moment the
  // alarm becomes due both look instant.
  useEffect(() => {
    if (phase === "dismissed") return;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase === "ringing") void start();
    else stop();
  }, [phase, start, stop]);

  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(due);

  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(due);

  /*
   * The tap silences immediately — but silence is only honest once the server
   * agrees the alarm is dealt with. On any failure the tone RESUMES: a screen
   * that says "ringing" while permanently silent is the silent-alarm failure
   * this whole feature exists to prevent (caught in review — a failed dismiss
   * used to strand exactly that state).
   */
  function dismiss() {
    stop();
    doneHaptic();
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof setItemDone>>;
      try {
        result = await setItemDone(id, true);
      } catch {
        result = { error: "Couldn't reach MeOS — the alarm is still on." };
      }
      if (result.error) {
        toast.error(result.error);
        if (phase === "ringing") start();
        return;
      }
      // A recurring alarm re-arms itself; saying so is the difference between
      // "it repeats" being a feature and being a surprise tomorrow morning.
      if (result.advancedTo) {
        const label = dueLabel(result.advancedTo, false, new Date(), browserTimeZone());
        toast.success(label ? `Rings again ${label}` : "Rings again next time");
      }
      router.replace("/");
    });
  }

  function snooze() {
    stop();
    tapHaptic();
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof snoozeAlarm>>;
      try {
        result = await snoozeAlarm(id);
      } catch {
        result = { error: "Couldn't reach MeOS — the alarm is still on." };
      }
      if (result.error) {
        toast.error(result.error);
        if (phase === "ringing") start();
        return;
      }
      toast.success(`Snoozed for ${SNOOZE_MINUTES} minutes`);
      router.replace("/");
    });
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-between px-6 py-12 text-center">
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <span
          className={cn(
            "flex size-20 items-center justify-center rounded-full",
            phase === "ringing"
              ? "bg-cat-reminder/15 text-cat-reminder motion-safe:animate-pulse"
              : "bg-secondary text-muted-foreground",
          )}
        >
          <AlarmClock className="size-10" aria-hidden />
        </span>

        <p data-numeric className="text-6xl font-semibold tracking-tight tabular-nums">
          {clock}
        </p>
        <h1 className="text-2xl font-medium">{title}</h1>

        <p role="status" className="max-w-sm text-base text-muted-foreground">
          {phase === "ringing" && (snoozeCount > 0
            ? `Snoozed ${snoozeCount} ${snoozeCount === 1 ? "time" : "times"} already.`
            : day)}
          {phase === "waiting" && `Rings in ${countdown(msUntil(due, now))} · ${day}`}
          {phase === "missed" && `This should have rung on ${day}. Your phone was unreachable.`}
          {phase === "dismissed" && "Already dismissed."}
        </p>

        {phase === "ringing" && ringState === "blocked" && (
          <button
            type="button"
            onClick={() => void start()}
            className="flex min-h-13 items-center gap-2 rounded-full bg-warning/15 px-5 text-base font-medium text-warning"
          >
            <Volume2 className="size-5" aria-hidden />
            Tap to hear it — your browser blocked the sound
          </button>
        )}
      </div>

      <div className="flex w-full max-w-sm flex-col gap-3">
        {/*
          Offered before it rings and after it didn't — never during. While the
          tone is playing there are exactly two things to do, and a third
          target is one the user has to read before they can silence anything.
        */}
        {(phase === "waiting" || phase === "missed") && (
          <OsAlarmButton dueAt={dueAt} title={title} timeZone={timeZone} />
        )}

        {phase === "ringing" && (
          <button
            type="button"
            onClick={snooze}
            disabled={pending}
            className="flex h-14 items-center justify-center gap-2 rounded-lg bg-secondary text-body font-semibold text-foreground transition-transform duration-150 active:scale-[0.985] disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
            Snooze {SNOOZE_MINUTES} min
          </button>
        )}

        {phase === "dismissed" ? (
          <Link
            href="/"
            className="flex h-14 items-center justify-center rounded-lg bg-primary text-body font-semibold text-primary-foreground shadow-accent"
          >
            Back to today
          </Link>
        ) : (
          <button
            type="button"
            onClick={dismiss}
            disabled={pending}
            aria-busy={pending}
            className="flex h-14 items-center justify-center gap-2 rounded-lg bg-primary text-body font-semibold text-primary-foreground shadow-accent transition-transform duration-150 active:scale-[0.985] disabled:opacity-50 disabled:shadow-none"
          >
            {pending ? (
              <Loader2 className="size-5 animate-spin" aria-hidden />
            ) : (
              <BellOff className="size-5" aria-hidden />
            )}
            {phase === "waiting" ? "Cancel this alarm" : "Dismiss"}
          </button>
        )}

        {/*
          The limit, stated where it matters rather than buried in settings. A
          web app cannot pierce Do Not Disturb — saying so is the difference
          between a tool that is honest about its edges and one that fails
          silently at 7am.
        */}
        <p className="text-xs text-muted-foreground">
          MeOS rings through a notification. Phones silence those in Do Not Disturb, so keep your
          usual alarm for anything you can&apos;t miss.
        </p>
      </div>
    </main>
  );
}
