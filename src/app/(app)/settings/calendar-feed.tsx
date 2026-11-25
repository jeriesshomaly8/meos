"use client";

import { useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import { CalendarPlus, Check, Copy, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  createCalendarFeed,
  revokeCalendarFeed,
  rotateCalendarFeed,
} from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";

/**
 * Subscribe-to-my-dates, and the four things that are true about it.
 *
 * Stated here rather than in a help page nobody opens (§6.1): the feed is
 * one-way, it is not instant, the link is the password, and replacing the link
 * breaks every calendar already subscribed to it. All four bite *after* the
 * user has set it up, which is exactly why they are on the surface that sets
 * it up.
 */
export function CalendarFeed({
  token,
  origin,
  lastFetchedAt,
}: {
  token: string | null;
  /** Absolute origin of this deployment; the feed URL has to be absolute. */
  origin: string;
  lastFetchedAt: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  const feedUrl = token ? `${origin}/calendar/${token}/feed.ics` : null;
  // webcal:// is what makes a tap open the calendar app's subscribe flow
  // instead of downloading a one-off file that never updates again.
  const subscribeUrl = feedUrl?.replace(/^https?:/, "webcal:") ?? null;

  function run(action: () => Promise<{ error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setCopied(false);
      toast.success(success);
    });
  }

  async function copy() {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      toast.success("Link copied");
    } catch {
      // Clipboard access is refused over plain HTTP and in some in-app
      // browsers. The link is selectable text, so say that rather than failing
      // silently.
      toast.error("Couldn't copy automatically — select the link and copy it.");
    }
  }

  if (!token || !feedUrl || !subscribeUrl) {
    return (
      <div className="flex flex-col gap-3 rounded-lg bg-card p-4 shadow-card">
        <p className="text-base text-muted-foreground">
          Publish your birthdays, expiry dates, alarms and dated tasks as a calendar your phone can
          subscribe to. MeOS only ever writes to it — it never reads your calendar back.
        </p>
        <Button
          type="button"
          className="self-start"
          disabled={pending}
          onClick={() => run(createCalendarFeed, "Your calendar feed is live")}
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <CalendarPlus aria-hidden />}
          Publish my dates
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-card p-4 shadow-card">
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">Subscription link</p>
        <p className="rounded-md bg-secondary px-3 py-2.5 font-mono text-xs break-all select-all">
          {feedUrl}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void copy()}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copied" : "Copy link"}
        </Button>
        <Button variant="outline" render={<a href={subscribeUrl} />}>
          Subscribe on this device
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        {lastFetchedAt
          ? `Last fetched by a calendar ${formatDistanceToNow(new Date(lastFetchedAt), {
              addSuffix: true,
            })}.`
          : "No calendar has fetched it yet. Subscribe on your phone, then check back."}
      </p>

      <p className="text-sm text-muted-foreground">
        One-way and read-only. Calendars refresh on their own schedule — an iPhone roughly hourly,
        Google Calendar often much slower — so something you add here can take hours to appear
        there. Anyone with this link can read these dates without signing in, so treat it like a
        password.
      </p>

      <div className="flex flex-wrap gap-2 border-t border-hairline pt-3">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(rotateCalendarFeed, "New link created — re-subscribe on your devices")
          }
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}
          Replace link
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={() => run(revokeCalendarFeed, "Calendar feed turned off")}
        >
          Turn it off
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Replacing or turning it off stops the old link immediately, everywhere it&apos;s subscribed.
      </p>
    </div>
  );
}
