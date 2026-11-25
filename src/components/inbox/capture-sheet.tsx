"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleStop, ImagePlus, Loader2, Mic, MicOff, Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { CAPTURE_MAX_CHARS } from "@/lib/capture/limits";
import { preparePhoto, type PreparedPhoto } from "@/lib/capture/photo";
import type { ExtractedItem } from "@/lib/extraction/schema";
import { describeItems } from "@/lib/extraction/describe";
import { joinSpoken, useDictation } from "@/lib/voice/dictation";
import { usePressToTalk } from "@/lib/voice/press-to-talk";
import { cn } from "@/lib/utils";
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetTitle } from "@/components/kit/sheet";
import { ConfirmationPanel, type EditableItem } from "./confirmation-panel";
import type { PersonMatch } from "@/app/api/analyze/route";

const MAX_CHARS = CAPTURE_MAX_CHARS;
/** Show the counter only once the limit is close enough to matter. */
const COUNTER_THRESHOLD = MAX_CHARS - 400;

const EXAMPLES = [
  "Sarah's birthday is 22 September and she loves white flowers",
  "Mom is severely allergic to peanuts",
  "My passport expires 14 May 2028 — remind me 6 months before",
];

interface AnalyzeSuccess {
  entryId: string;
  items: ExtractedItem[];
  matches: Record<string, PersonMatch>;
  droppedCount: number;
  /** Cross-checks worth saying now — a passport expiring near a trip. */
  notices?: string[];
}

/** Shared by the analyze failure and the dictation failure — same tone, same shape. */
function ErrorNote({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <p
      id={id}
      role="alert"
      className="mt-3 flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2.5 text-base text-destructive"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

type CaptureState =
  | { phase: "compose" }
  | { phase: "analyzing" }
  | {
      phase: "confirming";
      entryId: string;
      items: EditableItem[];
      droppedCount: number;
      notices: string[];
    }
  | {
      phase: "saving";
      entryId: string;
      items: EditableItem[];
      droppedCount: number;
      notices: string[];
    };

export function CaptureSheet({
  open,
  onOpenChange,
  initialText = "",
  initialEntryId = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Text the sheet opens with — what another app shared into MeOS.
   *
   * Read once, at mount. The tab bar remounts the sheet when a share arrives
   * (see its `key`), which is what lets this be plain initial state instead of
   * an effect that syncs a prop into state and fights whatever is being typed.
   */
  initialText?: string;
  /**
   * The pending inbox entry this text came from — a Siri capture under
   * review. Passed to analyze so the capture lives one lifecycle instead of
   * minting a twin entry.
   */
  initialEntryId?: string | null;
}) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [state, setState] = useState<CaptureState>({ phase: "compose" });
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const busy = state.phase === "analyzing" || state.phase === "saving";

  // Dictation appends finished phrases to whatever is already typed; interim
  // words are shown but never committed, so nothing lands twice.
  const appendSpoken = useCallback((chunk: string) => {
    setText((current) => joinSpoken(current, chunk).slice(0, MAX_CHARS));
  }, []);
  const dictation = useDictation({ onText: appendSpoken });
  const listening = dictation.status === "listening";
  const pressToTalk = usePressToTalk({
    listening,
    start: dictation.start,
    stop: dictation.stop,
  });

  const reset = useCallback(() => {
    setText("");
    setPhoto(null);
    setError(null);
    setState({ phase: "compose" });
  }, []);

  const close = useCallback(() => {
    // Never leave the microphone open behind a closed sheet.
    dictation.stop();
    onOpenChange(false);
    // Let the exit animation finish before wiping the content, otherwise the
    // sheet visibly empties on its way down.
    setTimeout(reset, 250);
  }, [dictation, onOpenChange, reset]);

  const analyze = useCallback(async () => {
    dictation.stop();
    const trimmed = text.trim();
    if (!trimmed && !photo) {
      setError("Write something first — anything you want MeOS to remember. Or attach a photo.");
      textareaRef.current?.focus();
      return;
    }
    setError(null);
    setState({ phase: "analyzing" });
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: trimmed,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          ...(initialEntryId ? { entryId: initialEntryId } : {}),
          ...(photo ? { image: { mimeType: photo.mimeType, dataBase64: photo.dataBase64 } } : {}),
        }),
      });
      const payload = (await response.json()) as
        | AnalyzeSuccess
        | { error: { code: string; message: string } };
      if (!response.ok || "error" in payload) {
        setError(
          "error" in payload ? payload.error.message : "Analysis failed. Please try again.",
        );
        setState({ phase: "compose" });
        return;
      }
      if (payload.items.length === 0) {
        setError(
          "MeOS didn't find anything to remember in that. Try adding specifics — names, dates, preferences.",
        );
        setState({ phase: "compose" });
        return;
      }
      setState({
        phase: "confirming",
        entryId: payload.entryId,
        droppedCount: payload.droppedCount,
        notices: payload.notices ?? [],
        items: payload.items.map((item) => {
          const match = payload.matches[item.temporaryId];
          return {
            item,
            included: true,
            matchedPersonId: match?.personId ?? null,
            matchedPersonName: match?.personName ?? null,
            useExistingPerson: Boolean(match),
            dateChoice: null,
          };
        }),
      });
    } catch {
      setError("Couldn't reach MeOS. Check your connection and try again.");
      setState({ phase: "compose" });
    }
  }, [dictation, initialEntryId, photo, text]);

  const save = useCallback(
    async (items: EditableItem[]) => {
      if (state.phase !== "confirming") return;
      const approved = items.filter((entry) => entry.included);
      if (approved.length === 0) {
        toast.error("Keep at least one item, or discard them all.");
        return;
      }
      setState({ ...state, phase: "saving", items });
      try {
        const response = await fetch("/api/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entryId: state.entryId,
            items: approved.map((entry) => ({
              item: entry.item,
              existingPersonId: entry.useExistingPerson ? entry.matchedPersonId : null,
            })),
          }),
        });
        const payload = (await response.json()) as
          | { created: unknown[] }
          | { error: { code: string; message: string } };
        if (!response.ok || "error" in payload) {
          toast.error(
            "error" in payload ? payload.error.message : "Saving failed. Please try again.",
          );
          setState({ ...state, phase: "confirming", items });
          return;
        }
        toast.success(
          // Names what landed, not how many rows moved (§1.8).
          `Saved ${describeItems(approved.map((entry) => entry.item))}`,
        );
        close();
        router.refresh();
      } catch {
        toast.error("Couldn't reach MeOS. Nothing was saved — try again.");
        setState({ ...state, phase: "confirming", items });
      }
    },
    [close, router, state],
  );

  const reviewing = state.phase === "confirming" || state.phase === "saving";

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <SheetContent aria-describedby={undefined} onDismiss={close}>
        <header className="shrink-0 px-4 pb-3 pt-3 sm:pt-5">
          <SheetTitle>{reviewing ? "Does this look right?" : "Tell MeOS anything"}</SheetTitle>
        </header>

        {reviewing ? (
          <ConfirmationPanel
            items={state.items}
            droppedCount={state.droppedCount}
            notices={state.notices}
            saving={state.phase === "saving"}
            onSave={save}
            onDiscard={close}
            onEditOriginal={() => setState({ phase: "compose" })}
          />
        ) : (
          <>
            <SheetBody>
              <label htmlFor="capture-text" className="sr-only">
                What should MeOS remember?
              </label>
              <textarea
                id="capture-text"
                ref={textareaRef}
                autoFocus
                value={text}
                onChange={(event) => setText(event.target.value.slice(0, MAX_CHARS))}
                placeholder="Sarah's birthday is 22 September…"
                rows={5}
                disabled={busy}
                aria-describedby={error ? "capture-error" : undefined}
                aria-invalid={error ? true : undefined}
                className="w-full resize-none bg-transparent font-display text-xl leading-snug outline-none placeholder:text-muted-foreground/45 disabled:opacity-60"
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void analyze();
                  }
                }}
              />

              {photo && (
                <div className="mt-3 flex items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a
                      local data URL preview; next/image adds nothing here. */}
                  <img
                    src={photo.dataUrl}
                    alt="Photo to be read"
                    className="h-20 w-20 rounded-md object-cover shadow-card"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-muted-foreground">
                      MeOS will read what&apos;s in the photo — a poster becomes an event, a
                      receipt a document, a scribbled list a real one. The photo itself is read
                      once and never stored.
                    </p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setPhoto(null)}
                      className="mt-1 text-sm font-medium text-primary active:opacity-60"
                    >
                      Remove photo
                    </button>
                  </div>
                </div>
              )}

              {error && <ErrorNote id="capture-error">{error}</ErrorNote>}
              {dictation.error && <ErrorNote>{dictation.error}</ErrorNote>}

              {listening && (
                <p className="mt-3 flex items-baseline gap-2 text-sm text-muted-foreground">
                  {/* Only "Listening…" is announced. The interim words change on
                      every syllable and would flood a screen reader. */}
                  <span role="status" className="flex shrink-0 items-center gap-2">
                    <span
                      className="size-2 rounded-full bg-destructive motion-safe:animate-pulse"
                      aria-hidden
                    />
                    Listening…
                  </span>
                  {dictation.interim && (
                    <span className="italic opacity-70" aria-hidden>
                      {dictation.interim}
                    </span>
                  )}
                </p>
              )}

              {!text && !listening && (
                <div className="mt-5">
                  <p className="mb-2 px-0.5 text-2xs font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                    Or try
                  </p>
                  <ul className="flex flex-col gap-2">
                    {EXAMPLES.map((example) => (
                      <li key={example}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setText(example);
                            textareaRef.current?.focus();
                          }}
                          className="w-full rounded-md bg-secondary px-3.5 py-2.5 text-start text-base text-secondary-foreground transition-colors active:bg-accent"
                        >
                          {example}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </SheetBody>

            <SheetFooter className="flex items-center gap-3 pb-3">
              {/* Absent, not disabled, where the API doesn't exist — an
                  affordance that can never work is worse than none. */}
              {dictation.status !== "unsupported" && (
                <button
                  type="button"
                  {...pressToTalk}
                  disabled={busy}
                  aria-pressed={listening}
                  aria-label={
                    listening ? "Stop dictating" : "Dictate instead of typing — tap, or hold to talk"
                  }
                  className={cn(
                    "flex size-13 shrink-0 touch-manipulation select-none items-center justify-center rounded-lg transition-colors disabled:opacity-50",
                    listening
                      ? "bg-destructive/10 text-destructive"
                      : "bg-secondary text-secondary-foreground active:bg-accent",
                  )}
                >
                  {listening ? (
                    <CircleStop className="size-5.5" aria-hidden />
                  ) : dictation.status === "denied" ? (
                    <MicOff className="size-5.5" aria-hidden />
                  ) : (
                    <Mic className="size-5.5" aria-hidden />
                  )}
                </button>
              )}

              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  const prepared = await preparePhoto(file);
                  if (prepared) {
                    setPhoto(prepared);
                    setError(null);
                  } else {
                    setError("Couldn't read that image — try another one.");
                  }
                }}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => photoInputRef.current?.click()}
                aria-label={photo ? "Replace the photo" : "Attach a photo to read"}
                className={cn(
                  "flex size-13 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-50",
                  photo
                    ? "bg-primary/10 text-primary"
                    : "bg-secondary text-secondary-foreground active:bg-accent",
                )}
              >
                <ImagePlus className="size-5.5" aria-hidden />
              </button>

              {text.length > COUNTER_THRESHOLD && (
                <span
                  data-numeric
                  className={cn(
                    "text-xs",
                    text.length >= MAX_CHARS ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {MAX_CHARS - text.length}
                </span>
              )}
              <button
                type="button"
                onClick={() => void analyze()}
                disabled={busy}
                aria-busy={state.phase === "analyzing"}
                className="flex h-13 flex-1 items-center justify-center gap-2 rounded-lg bg-primary text-body font-semibold text-primary-foreground shadow-accent transition-[transform,opacity] duration-150 active:scale-[0.985] disabled:opacity-60"
              >
                {state.phase === "analyzing" ? (
                  <>
                    <Loader2 className="size-4.5 animate-spin" aria-hidden />
                    Reading it…
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4.5" aria-hidden />
                    Remember this
                  </>
                )}
              </button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
