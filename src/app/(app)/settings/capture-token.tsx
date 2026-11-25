"use client";

import { useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import { Copy, Mic } from "lucide-react";
import { toast } from "sonner";
import {
  ensureCaptureToken,
  revokeCaptureToken,
  rotateCaptureToken,
} from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";

/**
 * Where "Hey Siri, tell MeOS…" gets set up. Same shape as the calendar feed
 * card below it: off is an explainer with one button, on shows the URL, the
 * one-time Shortcut recipe, and the honest limits — captured text waits in
 * the inbox for review; it is never saved behind the user's back.
 */

const SHORTCUT_STEPS = [
  "Open the Shortcuts app and tap + to make a new shortcut.",
  "Add the action “Dictate Text”.",
  "Add “Get Contents of URL”: paste your capture link, set Method to POST, Request Body to JSON, and add one field named “text” set to the Dictated Text variable.",
  "Name the shortcut something you'd say — “Tell MeOS” — and that phrase becomes the Siri command.",
] as const;

export function CaptureToken({
  token,
  origin,
  lastUsedAt,
}: {
  token: string | null;
  origin: string;
  lastUsedAt: string | null;
}) {
  const [currentToken, setCurrentToken] = useState(token);
  const [pending, startTransition] = useTransition();

  const url = currentToken ? `${origin}/api/capture/${currentToken}` : null;

  function enable() {
    startTransition(async () => {
      const result = await ensureCaptureToken();
      if (result.error) toast.error(result.error);
      else setCurrentToken(result.token ?? null);
    });
  }

  function rotate() {
    startTransition(async () => {
      const result = await rotateCaptureToken();
      if (result.error) toast.error(result.error);
      else {
        setCurrentToken(result.token ?? null);
        toast.success("New link made — update it inside your shortcut.");
      }
    });
  }

  function revoke() {
    startTransition(async () => {
      const result = await revokeCaptureToken();
      if (result.error) toast.error(result.error);
      else {
        setCurrentToken(null);
        toast.success("Capture from Siri is off.");
      }
    });
  }

  async function copy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    toast.success("Link copied.");
  }

  if (!currentToken) {
    return (
      <div className="flex flex-col gap-3 rounded-lg bg-card p-4 shadow-card">
        <p className="flex items-start gap-2.5 text-base text-muted-foreground">
          <Mic className="mt-0.5 size-4.5 shrink-0 text-primary" aria-hidden />
          <span>
            Say &ldquo;Hey Siri, tell MeOS&rdquo; with your phone in your pocket, and the words
            land here — waiting for your review, never saved behind your back. Turning this on
            makes a private capture link for a Shortcut to use.
          </span>
        </p>
        <Button variant="outline" size="sm" className="self-start" onClick={enable} disabled={pending}>
          {pending ? "Turning on…" : "Turn on capture from Siri"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-card p-4 shadow-card">
      <p className="flex items-start gap-2.5 text-base text-muted-foreground">
        <Mic className="mt-0.5 size-4.5 shrink-0 text-primary" aria-hidden />
        <span>
          Anything sent to this link waits in your inbox for review — the link is the password,
          so share it with nobody and nothing but your own shortcut.
          {lastUsedAt && (
            <>
              {" "}
              Last capture {formatDistanceToNow(new Date(lastUsedAt), { addSuffix: true })}.
            </>
          )}
        </span>
      </p>

      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-secondary px-3 py-2 text-xs">
          {url}
        </code>
        <Button type="button" variant="outline" size="icon" aria-label="Copy capture link" onClick={copy}>
          <Copy aria-hidden />
        </Button>
      </div>

      <ol className="flex flex-col gap-2">
        {SHORTCUT_STEPS.map((step, index) => (
          <li key={step} className="flex gap-2.5 text-sm text-muted-foreground">
            <span
              data-numeric
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground"
              aria-hidden
            >
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">{step}</span>
          </li>
        ))}
      </ol>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={rotate} disabled={pending}>
          Replace the link
        </Button>
        <Button variant="ghost" size="sm" onClick={revoke} disabled={pending}>
          Turn off
        </Button>
      </div>
    </div>
  );
}
