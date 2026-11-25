"use client";

import { useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useKeyboardLift } from "@/lib/use-visual-viewport";
import { shouldDismissSheet } from "@/lib/swipe";
import { cn } from "@/lib/utils";

/**
 * Bottom sheet on phones, centred modal from `sm` up.
 *
 * Sheets rather than routed pages for capture and confirm: the user is in
 * the middle of a thought, and pushing a new screen makes them feel like
 * they've left the app. A sheet keeps the context they came from visible
 * behind it, and dismissing it is a downward flick — for real, not as a
 * decoration: pass `onDismiss` and the drag works anywhere that isn't a
 * control or the scrolling body.
 *
 * The sheet also rides the iOS keyboard. Fixed-bottom elements glue
 * themselves to the *layout* viewport, whose bottom the keyboard covers; the
 * keyboard-lift hook measures the visible viewport and the popup translates
 * up to live inside it — without this, the capture textarea ends up clipped
 * off the top of the screen and the footer under the keys (the 2026-08-16
 * phone findings).
 */
export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

export function SheetTitle({ className, ...props }: Dialog.Title.Props) {
  return <Dialog.Title className={cn("font-display text-xl", className)} {...props} />;
}

export function SheetDescription({ className, ...props }: Dialog.Description.Props) {
  return (
    <Dialog.Description className={cn("text-base text-muted-foreground", className)} {...props} />
  );
}

/** Anything a finger might be *using* rather than dragging. */
const INTERACTIVE = "button, a, input, textarea, select, label, [role='radiogroup']";

export function SheetContent({
  className,
  children,
  onDismiss,
  ...props
}: Dialog.Popup.Props & {
  children: React.ReactNode;
  /** Enables drag-to-close. Called when a downward pull or flick commits. */
  onDismiss?: () => void;
}) {
  const { lift, visibleHeight } = useKeyboardLift();

  const [dragY, setDragY] = useState(0);
  // pointerId identifies the dragging finger — a second fingertip must be a
  // bystander, not a co-author of the gesture.
  const drag = useRef<{
    pointerId: number;
    startY: number;
    startedAt: number;
    engaged: boolean;
  } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!onDismiss || e.pointerType === "mouse" || drag.current) return;
    const target = e.target as HTMLElement;
    // The scrolling body owns its own vertical gestures; controls own taps.
    if (target.closest("[data-sheet-body]") || target.closest(INTERACTIVE)) return;
    drag.current = { pointerId: e.pointerId, startY: e.clientY, startedAt: e.timeStamp, engaged: false };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || e.pointerId !== state.pointerId) return;
    const dy = e.clientY - state.startY;
    if (!state.engaged) {
      if (dy < 12) return;
      state.engaged = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setDragY(Math.max(0, dy));
  }

  function onPointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || e.pointerId !== state.pointerId) return;
    const dy = Math.max(0, e.clientY - state.startY);
    const velocity = dy / Math.max(1, e.timeStamp - state.startedAt);
    const commit = state.engaged && shouldDismissSheet(dy, velocity);
    drag.current = null;
    setDragY(0);
    if (commit) onDismiss?.();
  }

  /*
   * One transform serves both behaviours: lifted above the keyboard, pulled
   * down by the finger. Applied inline, so it only wins after the open
   * animation has finished — which is always before a keyboard or a finger
   * can be involved.
   */
  const translate = dragY - lift;
  const style: React.CSSProperties = {};
  if (translate !== 0) style.transform = `translateY(${translate}px)`;
  if (visibleHeight !== null) style.maxHeight = `${Math.max(240, visibleHeight - 8)}px`;
  if (dragY > 0) style.transition = "none";

  return (
    <Dialog.Portal>
      <Dialog.Backdrop
        className={cn(
          "fixed inset-0 z-50 bg-foreground/25 duration-200 supports-backdrop-filter:backdrop-blur-[3px]",
          "data-open:animate-in data-open:fade-in-0",
          "data-closed:animate-out data-closed:fade-out-0",
        )}
      />
      <Dialog.Popup
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col",
          "rounded-t-2xl bg-background shadow-sheet outline-none",
          "duration-250 ease-[var(--ease-out-soft)]",
          "data-open:animate-in data-open:slide-in-from-bottom-1/4",
          "data-closed:animate-out data-closed:slide-out-to-bottom-1/4",
          "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[85dvh] sm:w-full sm:max-w-xl",
          "sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
          "sm:data-open:zoom-in-95 sm:data-open:slide-in-from-bottom-0",
          "sm:data-closed:zoom-out-95 sm:data-closed:slide-out-to-bottom-0",
          className,
        )}
        style={style}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        {...props}
      >
        {/* Grab handle — a tall enough strip to actually grab. */}
        <div
          className="flex min-h-6 shrink-0 touch-none justify-center pt-2.5 sm:hidden"
          aria-hidden
        >
          <span className="h-1 w-9 rounded-full bg-foreground/15" />
        </div>
        {children}
      </Dialog.Popup>
    </Dialog.Portal>
  );
}

/** Scrollable middle of a sheet. Always pair with SheetFooter. */
export function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-sheet-body
      className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4", className)}
      {...props}
    />
  );
}

/** Pinned action bar. Sits above the home indicator on iOS. */
export function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "safe-b shrink-0 border-t border-hairline bg-background/95 px-4 pt-3",
        "supports-backdrop-filter:bg-background/80 supports-backdrop-filter:backdrop-blur",
        className,
      )}
      {...props}
    />
  );
}
