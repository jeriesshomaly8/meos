"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, Check, ChevronDown, ListChecks } from "lucide-react";
import { toast } from "sonner";
import { setItemDone, setItemDueAt, setListItemChecked } from "@/app/(app)/actions";
import type { ActionableItem } from "@/lib/items/rows";
import { doneHaptic, tapHaptic } from "@/lib/haptics";
import { isHorizontalIntent, pullOffset, shouldCommit } from "@/lib/swipe";
import { cn } from "@/lib/utils";

/*
 * The shape lives in `@/lib/items/rows` beside the query that produces it, so
 * the four screens rendering these rows agree on it without importing a
 * component to get at a type.
 */
export type { ActionableItem, ActionableListItem } from "@/lib/items/rows";

/**
 * A task or list on Today, tickable in place — by the circle, or by swiping
 * the whole row to the right, the way a thumb expects to.
 *
 * Optimistic: the tick lands immediately and rolls back on failure, because
 * waiting ~300ms to see a checkbox respond is the difference between an app
 * that feels native and one that feels like a web page. Completing shows an
 * Undo toast instead of asking first — doing-then-offering-to-undo is faster
 * than confirming, and just as safe.
 */
export function ActionableRow({ item }: { item: ActionableItem }) {
  const router = useRouter();
  const [done, setDone] = useState(item.done);
  const [expanded, setExpanded] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>(
    Object.fromEntries(item.listItems.map((entry) => [entry.id, entry.checked])),
  );
  const [pending, startTransition] = useTransition();

  /*
   * Swipe state. Offset drives the row's translation; `swiping` flags a drag
   * that has declared itself horizontal (and therefore suppresses the tap the
   * pointer sequence would otherwise fire on release).
   */
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);
  // pointerId is part of the state: without it, a second fingertip's lift
  // could commit finger A's held swipe, or its movement corrupt the offset.
  const dragStart = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  const remaining = item.listItems.filter((entry) => !checked[entry.id]).length;
  const isList = item.capability === "list";
  const isAlarm = item.capability === "alarm";

  function toggleItem(next: boolean) {
    setDone(next);
    if (next) doneHaptic();
    startTransition(async () => {
      const result = await setItemDone(item.id, next);
      if (result.error) {
        setDone(!next);
        toast.error(result.error);
        return;
      }
      if (next) {
        // The row may leave the screen on refresh; the toast is where the
        // way back lives. Undo re-opens the item, no questions asked — and
        // for a recurring item it puts the date back rather than un-finishing
        // a row that was never finished.
        const undo = result.previousDueAt
          ? () => setItemDueAt(item.id, result.previousDueAt!)
          : () => setItemDone(item.id, false);
        toast(result.advancedTo ? "Done — until next time" : isAlarm ? "Alarm dismissed" : "Done", {
          action: {
            label: "Undo",
            onClick: () => {
              void undo().then((undone) => {
                if (undone.error) toast.error(undone.error);
                else router.refresh();
              });
            },
          },
        });
      }
      router.refresh();
    });
  }

  function toggleLine(lineId: string, next: boolean) {
    setChecked((current) => ({ ...current, [lineId]: next }));
    if (next) tapHaptic();
    startTransition(async () => {
      const result = await setListItemChecked(lineId, next);
      if (result.error) {
        setChecked((current) => ({ ...current, [lineId]: !next }));
        toast.error(result.error);
      }
    });
  }

  /* Swipe right to complete. Vertical drags stay scrolls (touch-action pan-y
     plus the intent test); the gesture is unavailable once done or pending,
     and never steals the tap targets — they keep working untouched. */
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (done || pending || e.pointerType === "mouse" || dragStart.current) return;
    dragStart.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const start = dragStart.current;
    if (!start || e.pointerId !== start.pointerId) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!swiping) {
      if (!isHorizontalIntent(dx, dy)) return;
      setSwiping(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setOffset(pullOffset(dx));
  }

  function onPointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    const start = dragStart.current;
    if (!start || e.pointerId !== start.pointerId) return;
    const commit = swiping && shouldCommit(offset);
    dragStart.current = null;
    setSwiping(false);
    setOffset(0);
    if (commit) toggleItem(true);
  }

  /*
   * An alarm isn't finished, it's silenced — and the difference matters to a
   * screen reader, which reads this label out loud with no icon to disambiguate.
   */
  const toggleLabel = isAlarm
    ? `Dismiss the alarm “${item.title}”`
    : `Mark “${item.title}” ${done ? "not done" : "done"}`;

  return (
    <li className="relative overflow-hidden after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-hairline first:after:hidden">
      {/* The reveal behind the row: a green field and a check that commit to
          full opacity exactly when releasing would complete the item. */}
      {offset > 0 && (
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 flex items-center ps-5 transition-opacity",
            shouldCommit(offset) ? "bg-success opacity-100" : "bg-success/40 opacity-80",
          )}
        >
          <Check className="size-5 text-white" strokeWidth={3} />
        </div>
      )}
      <div
        className="relative flex min-h-[3.5rem] items-center gap-3 bg-card px-4 py-3"
        style={{
          touchAction: "pan-y",
          transform: offset > 0 ? `translateX(${offset}px)` : undefined,
          transition: swiping ? "none" : "transform 160ms ease-out",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <button
          type="button"
          onClick={() => toggleItem(!done)}
          disabled={pending}
          aria-pressed={done}
          aria-label={toggleLabel}
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-150",
            done
              ? "border-success bg-success text-white"
              : "border-input text-transparent active:border-success",
          )}
        >
          <Check className="size-4" strokeWidth={3} aria-hidden />
        </button>

        <div className="min-w-0 flex-1">
          <p className={cn("flex items-center gap-1.5 truncate font-medium", done && "text-muted-foreground line-through")}>
            {isAlarm && <AlarmClock className="size-4 shrink-0 text-cat-reminder" aria-hidden />}
            {item.title}
          </p>
          {(item.summary || item.whenLabel) && (
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
              {item.whenLabel && (
                <span className={cn(item.overdue && "font-medium text-destructive")}>
                  {item.whenLabel}
                </span>
              )}
              {item.whenLabel && item.summary && <span aria-hidden>·</span>}
              {item.summary && <span className="truncate">{item.summary}</span>}
            </p>
          )}
        </div>

        {isList && item.listItems.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            className="flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground"
          >
            <ListChecks className="size-3.5" aria-hidden />
            <span data-numeric>{remaining}</span>
            <ChevronDown
              className={cn("size-3.5 transition-transform duration-200", expanded && "rotate-180")}
              aria-hidden
            />
          </button>
        )}
      </div>

      {isList && expanded && (
        <ul className="pb-2 ps-16 pe-4">
          {item.listItems.map((entry) => {
            const isChecked = checked[entry.id] ?? false;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => toggleLine(entry.id, !isChecked)}
                  aria-pressed={isChecked}
                  className="flex min-h-11 w-full items-center gap-2.5 text-start"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      isChecked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input text-transparent",
                    )}
                  >
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                  <span className={cn("text-base", isChecked && "text-muted-foreground line-through")}>
                    {[entry.quantity, entry.unit, entry.text].filter(Boolean).join(" ")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
