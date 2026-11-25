"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The actual ringing.
 *
 * A Web Push notification plays the system notification sound once and cannot
 * loop, so the notification is only the tap target — this hook is where an
 * alarm becomes an alarm. It synthesises the tone with WebAudio rather than
 * shipping an audio file: no asset to load before the first beep, no decode
 * step, and it works offline.
 *
 * The honest limitation is autoplay policy. A page opened by tapping a
 * notification has had no user gesture inside it, so `AudioContext` starts
 * suspended and stays silent. That is reported as `blocked` rather than
 * pretended away: the screen shows a tap target and the vibration keeps going
 * meanwhile, because a silent screen claiming to be an alarm is the single
 * worst failure this feature can have.
 */

export type RingState = "idle" | "ringing" | "blocked";

/** Two-tone chirp: a rising pair reads as an alarm, a single tone reads as a notification. */
const TONE_HZ = [880, 1174.7];
/** Seconds. Short beeps with a gap carry through sleep better than a continuous drone. */
const BEEP_SECONDS = 0.18;
const BEEP_GAP_SECONDS = 0.12;
const CYCLE_MS = 1500;
/** Ramp instead of a hard gate — a square-edged gain change clicks audibly. */
const RAMP_SECONDS = 0.015;
const PEAK_GAIN = 0.9;
/** Android only; a no-op everywhere else. Matches the audio cycle. */
const VIBRATE_PATTERN = [400, 200, 400, 500];

export function useAlarmRing(): {
  state: RingState;
  start: () => Promise<void>;
  stop: () => void;
} {
  const [state, setState] = useState<RingState>("idle");
  const contextRef = useRef<AudioContext | null>(null);
  const cycleRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (cycleRef.current !== null) {
      clearInterval(cycleRef.current);
      cycleRef.current = null;
    }
    navigator.vibrate?.(0);
    contextRef.current?.close().catch(() => {
      // A context that is already closed is exactly the state we wanted.
    });
    contextRef.current = null;
    setState("idle");
  }, []);

  const start = useCallback(async () => {
    if (cycleRef.current !== null) return;

    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) {
      setState("blocked");
      return;
    }

    const context = contextRef.current ?? new AudioCtor();
    contextRef.current = context;

    // Vibration first: it needs no gesture, so a blocked context still buzzes.
    navigator.vibrate?.(VIBRATE_PATTERN);

    try {
      await context.resume();
    } catch {
      // Autoplay policy. Reported, not swallowed — the UI asks for a tap.
    }
    if (context.state !== "running") {
      setState("blocked");
      return;
    }

    const beep = () => {
      const now = context.currentTime;
      TONE_HZ.forEach((hz, index) => {
        const at = now + index * (BEEP_SECONDS + BEEP_GAP_SECONDS);
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "square";
        oscillator.frequency.value = hz;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(PEAK_GAIN, at + RAMP_SECONDS);
        gain.gain.setValueAtTime(PEAK_GAIN, at + BEEP_SECONDS - RAMP_SECONDS);
        gain.gain.linearRampToValueAtTime(0, at + BEEP_SECONDS);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(at);
        oscillator.stop(at + BEEP_SECONDS);
      });
      navigator.vibrate?.(VIBRATE_PATTERN);
    };

    beep();
    cycleRef.current = setInterval(beep, CYCLE_MS);
    setState("ringing");
  }, []);

  // Leaving the page must silence it. Without this, navigating away leaves an
  // AudioContext beeping with nothing on screen to stop it.
  useEffect(() => stop, [stop]);

  return { state, start, stop };
}
