"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, ChevronRight, Loader2, Sparkles, TriangleAlert } from "lucide-react";

const SUGGESTIONS = [
  "Where did I put the spare key?",
  "When does my passport expire?",
  "What food does Sarah dislike?",
  "Who still has my stuff?",
  "What's coming up this month?",
  "Which recipes contain eggs?",
];

interface Source {
  ref: string;
  kind: string;
  label: string;
  /** Where the record lives — a chip with an href opens the thing itself. */
  href?: string | null;
}

interface Exchange {
  question: string;
  answer: string;
  /** The records the answer drew on — resolved server-side, never model text. */
  sources: Source[];
}

const MAX_QUESTION = 500;

export function AskForm() {
  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const payload = (await response.json()) as
        | { answer: string; sources?: Source[] }
        | { error: { message: string } };
      if (!response.ok || "error" in payload) {
        setError("error" in payload ? payload.error.message : "That didn't go through. Try again.");
        return;
      }
      setExchanges((current) => [
        { question: trimmed, answer: payload.answer, sources: payload.sources ?? [] },
        ...current,
      ]);
      setQuestion("");
    } catch {
      setError("Couldn't reach MeOS. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
      >
        <label htmlFor="ask-question" className="sr-only">
          Your question
        </label>
        {/* Send button sits inside the field, the way every messaging app on
            a phone does it — one thumb, one target, no reaching. */}
        <div className="relative">
          <input
            id="ask-question"
            ref={inputRef}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask about anything you've saved…"
            disabled={loading}
            maxLength={MAX_QUESTION}
            className="h-13 w-full rounded-full bg-card ps-5 pe-14 text-base shadow-card outline-none placeholder:text-muted-foreground/70 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={loading || question.trim().length === 0}
            aria-label="Ask"
            className="absolute end-1.5 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground transition-[transform,opacity] duration-150 active:scale-92 disabled:opacity-35"
          >
            {loading ? (
              <Loader2 className="size-5 animate-spin" aria-hidden />
            ) : (
              <ArrowUp className="size-5" strokeWidth={2.5} aria-hidden />
            )}
          </button>
        </div>
      </form>

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2.5 text-base text-destructive"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      )}

      {loading && (
        <p className="flex items-center gap-2 text-base text-muted-foreground" role="status">
          <Sparkles className="size-4.5 animate-pulse text-primary" aria-hidden />
          Looking through your memory…
        </p>
      )}

      {exchanges.length === 0 && !loading && (
        <div className="rail -mx-4 gap-2 px-4 py-0.5">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={loading}
              onClick={() => {
                setQuestion(suggestion);
                inputRef.current?.focus();
              }}
              className="flex h-9 items-center rounded-full bg-card px-4 text-base text-muted-foreground shadow-card transition-colors active:bg-secondary"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <ul className="flex flex-col gap-3" aria-live="polite">
        {exchanges.map((exchange, index) => (
          <li key={`${exchange.question}-${index}`} className="flex flex-col gap-2">
            {/* The question is styled as the user's own bubble so a long
                thread stays readable as a conversation, not a log. */}
            <p className="ms-auto max-w-[85%] rounded-lg rounded-ee-xs bg-primary px-4 py-2.5 text-base text-primary-foreground">
              {exchange.question}
            </p>
            <div className="max-w-[92%] rounded-lg rounded-es-xs bg-card px-4 py-3 shadow-card">
              <p className="whitespace-pre-wrap text-base">{exchange.answer}</p>
              {/* Which of the user's own records the answer came from. Absent
                  when the model used none — that absence is itself a signal
                  the answer is a "nothing saved" response. */}
              {exchange.sources.length > 0 && (
                <p className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-hairline pt-2.5 text-sm text-muted-foreground">
                  From:
                  {exchange.sources.map((source) =>
                    source.href ? (
                      <Link
                        key={source.ref}
                        href={source.href}
                        className="flex min-h-7 items-center gap-1 rounded-full bg-secondary px-2.5 text-xs font-medium text-secondary-foreground transition-opacity active:opacity-60"
                      >
                        {source.label}
                        <ChevronRight className="size-3" aria-hidden />
                      </Link>
                    ) : (
                      <span
                        key={source.ref}
                        className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground"
                      >
                        {source.label}
                      </span>
                    ),
                  )}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
