"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Dictation over the Web Speech API.
 *
 * Voice is an input method for the capture box, not a second pipeline: final
 * phrases are appended to whatever the user has typed and the ordinary
 * analyze → confirm → save flow does the rest. A mishearing is then caught at
 * the same confirmation step that catches a typo, which is why this never needs
 * to be more accurate than the user's own review.
 *
 * The API is only in `lib.dom` in pieces — `SpeechRecognitionResultList` exists,
 * the recogniser itself does not — so the missing half is declared here under
 * our own names rather than augmenting globals TypeScript may add later.
 */

interface SpeechResultEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechFailureEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognizer {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechFailureEvent) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognizerConstructor = new () => SpeechRecognizer;

function recognizerConstructor(): SpeechRecognizerConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognizerConstructor;
    webkitSpeechRecognition?: SpeechRecognizerConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const DENIED_MESSAGE =
  "MeOS can't hear you — microphone access is blocked. Allow it in your browser's site settings, then tap the mic again.";
const NETWORK_MESSAGE =
  "Dictation needs a connection and couldn't reach the speech service. Type it instead, or try again in a moment.";
const GENERIC_MESSAGE = "Dictation stopped unexpectedly. Type it instead, or tap the mic again.";

/**
 * The browser ends a session after a few seconds of silence, and we restart it
 * so "listening" means listening. This bounds that loop: about twenty silent
 * restarts is a couple of minutes of nothing being said, at which point the
 * honest thing is to stop holding the microphone open.
 */
const MAX_SILENT_RESTARTS = 20;

export type DictationStatus = "unsupported" | "idle" | "listening" | "denied" | "error";

export interface Dictation {
  status: DictationStatus;
  /** Words being said right now, not yet final. Shown, never committed. */
  interim: string;
  error: string | null;
  start: () => void;
  stop: () => void;
}

/**
 * Appends a spoken phrase to text already in the box.
 *
 * Speech results arrive with no leading space and no sentence case, so joining
 * naively produces "Sarah's birthdayand she loves flowers".
 */
export function joinSpoken(existing: string, chunk: string): string {
  const addition = chunk.trim();
  if (!addition) return existing;
  if (!existing) return addition.charAt(0).toUpperCase() + addition.slice(1);
  return /\s$/.test(existing) ? existing + addition : `${existing} ${addition}`;
}

/** Capability, not state: nothing to subscribe to, and it never changes. */
const noopSubscribe = () => () => {};
const isSupportedOnClient = () => recognizerConstructor() !== null;
const isSupportedOnServer = () => false;

export function useDictation({ onText }: { onText: (chunk: string) => void }): Dictation {
  const [phase, setPhase] = useState<Exclude<DictationStatus, "unsupported">>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  /*
   * The server has no `window`, so support has to be read in a way that gives
   * the same answer during hydration as the HTML was built with — hence the
   * separate server snapshot rather than a `typeof window` check in render.
   */
  const supported = useSyncExternalStore(
    noopSubscribe,
    isSupportedOnClient,
    isSupportedOnServer,
  );

  const onTextRef = useRef(onText);
  const recognizerRef = useRef<SpeechRecognizer | null>(null);
  const listeningRef = useRef(false);
  const silentRestartsRef = useRef(0);

  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  useEffect(
    () => () => {
      listeningRef.current = false;
      recognizerRef.current?.abort();
    },
    [],
  );

  const stop = useCallback(() => {
    listeningRef.current = false;
    recognizerRef.current?.stop();
    setInterim("");
    setPhase((current) => (current === "listening" ? "idle" : current));
  }, []);

  const start = useCallback(() => {
    const Recognizer = recognizerConstructor();
    if (!Recognizer || listeningRef.current) return;

    setError(null);
    silentRestartsRef.current = 0;

    const recognition = new Recognizer();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      silentRestartsRef.current = 0;
      let pending = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const spoken = result[0]?.transcript ?? "";
        if (result.isFinal) onTextRef.current(spoken);
        else pending += spoken;
      }
      setInterim(pending);
    };

    recognition.onerror = (event) => {
      // Silence and our own abort() are not failures; `onend` handles both.
      if (event.error === "no-speech" || event.error === "aborted") return;
      listeningRef.current = false;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setPhase("denied");
        setError(DENIED_MESSAGE);
        return;
      }
      setPhase("error");
      setError(event.error === "network" ? NETWORK_MESSAGE : GENERIC_MESSAGE);
    };

    recognition.onend = () => {
      setInterim("");
      if (listeningRef.current && silentRestartsRef.current < MAX_SILENT_RESTARTS) {
        silentRestartsRef.current += 1;
        try {
          recognition.start();
          return;
        } catch {
          // Some browsers refuse an immediate restart; fall through to idle.
        }
      }
      listeningRef.current = false;
      setPhase((current) => (current === "listening" ? "idle" : current));
    };

    recognizerRef.current = recognition;
    listeningRef.current = true;
    try {
      recognition.start();
      setPhase("listening");
    } catch {
      listeningRef.current = false;
      setPhase("error");
      setError(GENERIC_MESSAGE);
    }
  }, []);

  return {
    status: supported ? phase : "unsupported",
    interim,
    error,
    start,
    stop,
  };
}
