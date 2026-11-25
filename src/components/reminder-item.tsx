"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { setReminderCompleted } from "@/app/(app)/actions";
import { daysUntil, daysUntilLabel } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { DeleteRecordButton } from "@/components/delete-record-button";

interface ReminderItemProps {
  id: string;
  title: string;
  remindAt: string;
  completed: boolean;
  relatedLabel?: string | null;
}

const URGENT_DAYS = 7;

/**
 * A list row that owns a checkbox, so it can't reuse `ListRow` (which is a
 * link or nothing). Styled to match it exactly — same height, same hairline,
 * same inset — so the two are indistinguishable in a shared list.
 *
 * The tick is a big circular target rather than a 16px checkbox: completing a
 * reminder is the whole point of the row and should be easy to hit one-handed.
 */
export function ReminderItem({ id, title, remindAt, completed, relatedLabel }: ReminderItemProps) {
  const router = useRouter();
  const [checked, setChecked] = useState(completed);
  const [pending, startTransition] = useTransition();
  const when = new Date(remindAt);
  const days = daysUntil(when);

  function toggle(next: boolean) {
    setChecked(next);
    startTransition(async () => {
      const result = await setReminderCompleted(id, next);
      if (result.error) {
        setChecked(!next);
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className="relative flex min-h-[3.5rem] items-center gap-3 px-4 py-3 after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-hairline first:after:hidden">
      <button
        type="button"
        onClick={() => toggle(!checked)}
        disabled={pending}
        aria-pressed={checked}
        aria-label={`Mark “${title}” ${checked ? "not done" : "done"}`}
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-150",
          checked
            ? "border-success bg-success text-white"
            : "border-input text-transparent active:border-success",
        )}
      >
        <Check className="size-4" strokeWidth={3} aria-hidden />
      </button>

      <div className="min-w-0 flex-1">
        <p className={cn("truncate font-medium", checked && "text-muted-foreground line-through")}>
          {title}
        </p>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">
          {format(when, "d MMM yyyy 'at' HH:mm")}
          {relatedLabel && ` · ${relatedLabel}`}
        </p>
      </div>

      {!checked && (
        <span
          data-numeric
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
            days <= URGENT_DAYS
              ? "bg-primary/12 text-primary"
              : "bg-secondary text-muted-foreground",
          )}
        >
          {daysUntilLabel(days)}
        </span>
      )}

      <DeleteRecordButton table="reminders" id={id} label={`reminder “${title}”`} />
    </li>
  );
}
