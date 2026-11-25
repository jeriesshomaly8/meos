"use client";

import { useCallback, useRef } from "react";

/**
 * A tap that latches, and a hold that doesn't.
 *
 * Two ways to dictate, because neither one alone covers the job. Holding the
 * button is right for a one-line thought — the finger says when it ends, so
 * there is nothing to remember to switch off. It is wrong for a shopping list:
 * a minute of held thumb while speaking into the phone you are gripping, and an
 * accidental release ends the session mid-sentence, taking the in-flight phrase
 * with it because `useDictation` only ever commits *final* results.
 *
 * A press-and-hold-only control is also the hardest kind for anyone with a
 * tremor or limited grip, which is why the short press stays a plain toggle and
 * keyboard activation never goes near the hold path at all.
 */

/**
 * Release faster than this and the microphone stays on, so a quick tap behaves
 * exactly as the button always did. Longer, and the press is read as "hold to
 * talk" and releasing ends it. 400 ms is comfortably past a deliberate tap and
 * well short of a held button.
 */
export const LATCH_WITHIN_MS = 400;

/**
 * A pointer sequence is followed by a synthetic `click`, which would undo the
 * decision just made on release. Clicks arriving within this window of a
 * release are that echo; anything later is a real activation, most likely a
 * keyboard's.
 */
const CLICK_ECHO_MS = 700;

/** What releasing after `heldMs` should do to a session the press started. */
export function releaseOutcome(heldMs: number): "latch" | "stop" {
  return heldMs >= LATCH_WITHIN_MS ? "stop" : "latch";
}

export interface PressToTalkHandlers {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onClick: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
}

export function usePressToTalk({
  listening,
  start,
  stop,
  now = () => Date.now(),
}: {
  listening: boolean;
  start: () => void;
  stop: () => void;
  /** Injectable so the latch threshold can be tested without real time. */
  now?: () => number;
}): PressToTalkHandlers {
  const pressedAtRef = useRef<number | null>(null);
  const releasedAtRef = useRef(0);
  /** A press that closed an already-running session; its release does nothing. */
  const closingRef = useRef(false);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      // Secondary buttons open menus; they should not drive the microphone.
      if (event.button !== 0) return;

      /*
       * Capture the pointer so the release lands here even if the finger slides
       * off the button — otherwise a hold that drifts never stops and the
       * microphone stays open.
       */
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Not implemented everywhere; the pointer just isn't captured.
      }

      if (listening) {
        closingRef.current = true;
        pressedAtRef.current = null;
        stop();
        return;
      }

      closingRef.current = false;
      pressedAtRef.current = now();
      start();
    },
    [listening, now, start, stop],
  );

  const release = useCallback(() => {
    releasedAtRef.current = now();

    if (closingRef.current) {
      closingRef.current = false;
      return;
    }

    const pressedAt = pressedAtRef.current;
    pressedAtRef.current = null;
    if (pressedAt === null) return;

    if (releaseOutcome(now() - pressedAt) === "stop") stop();
    // Otherwise it latches: the session simply carries on running.
  }, [now, stop]);

  const onClick = useCallback(() => {
    if (now() - releasedAtRef.current < CLICK_ECHO_MS) return;
    // No pointer led here, so this is a keyboard activation: a plain toggle.
    if (listening) stop();
    else start();
  }, [listening, now, start, stop]);

  /* A long press on a button raises the selection callout on touch devices. */
  const onContextMenu = useCallback((event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
  }, []);

  return {
    onPointerDown,
    onPointerUp: release,
    onPointerCancel: release,
    onClick,
    onContextMenu,
  };
}
