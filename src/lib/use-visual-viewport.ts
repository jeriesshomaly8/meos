"use client";

import { useEffect, useState } from "react";

/**
 * How far the iOS keyboard has eaten into the screen.
 *
 * On iOS the keyboard does NOT resize the layout viewport — `bottom: 0`
 * elements stay glued to a bottom that is now underneath the keyboard, which
 * is exactly the broken capture sheet in the 2026-08-16 phone screenshots:
 * textarea shoved off the top, footer buried. The *visual* viewport is the
 * part actually visible; the difference is what a bottom sheet must lift by.
 *
 * Only meaningful lifts are reported: URL-bar show/hide wobble (tens of
 * pixels) stays at zero so desktop and keyboard-less phones never see a
 * transform at all.
 */

const KEYBOARD_THRESHOLD_PX = 80;

export function useKeyboardLift(): { lift: number; visibleHeight: number | null } {
  const [state, setState] = useState<{ lift: number; visibleHeight: number | null }>({
    lift: 0,
    visibleHeight: null,
  });

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const update = () => {
      /*
       * Two guards, both from the review that caught them: pinch-zoom shrinks
       * the visual viewport exactly like a keyboard does on Android, and the
       * lift arithmetic is written for a bottom-anchored sheet — on the ≥sm
       * centered modal the translate classes *compose* with the inline
       * transform and over-shift by half the keyboard. So: phones only, and
       * never while zoomed.
       */
      const phoneLayout = window.matchMedia("(max-width: 639px)").matches;
      const zoomed = (viewport.scale ?? 1) > 1.05;
      const hidden = window.innerHeight - viewport.height - viewport.offsetTop;
      const keyboardOpen =
        phoneLayout && !zoomed && window.innerHeight - viewport.height > KEYBOARD_THRESHOLD_PX;
      setState({
        lift: keyboardOpen ? Math.max(0, hidden) : 0,
        visibleHeight: keyboardOpen ? viewport.height : null,
      });
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return state;
}
