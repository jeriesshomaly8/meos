import { NextResponse } from "next/server";
import { z } from "zod";
import { buildIcsCalendar } from "@/lib/calendar/ics";
import { createClient } from "@/lib/supabase/server";

/**
 * The published calendar: `webcal://…/calendar/<token>/feed.ics`.
 *
 * Unauthenticated on purpose — a calendar client cannot log in, it just fetches
 * a URL forever — so the 256-bit token is the credential, and the
 * `calendar_feed_events` function is the only thing that can turn it into rows.
 * This handler never sees a user id and cannot ask for one.
 *
 * `.ics` in the path because a handful of clients decide how to treat the
 * response by looking at the extension before they look at the content type.
 */
export const dynamic = "force-dynamic";

const feedSchema = z.object({
  calendarName: z.string(),
  timezone: z.string(),
  events: z.array(
    z.object({
      uid: z.string(),
      title: z.string(),
      description: z.string().nullable().optional(),
      kind: z.string().nullable().optional(),
      date: z.string().nullable().optional(),
      start: z.string().nullable().optional(),
      yearly: z.boolean().nullable().optional(),
    }),
  ),
});

/** Plain text, because whatever fetched this is not a browser. */
function plain(body: string, status: number) {
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("calendar_feed_events", { p_token: token });

  if (error) {
    console.error("[calendar] feed failed:", error.message);
    return plain("MeOS couldn't build this calendar right now. Try again shortly.", 503);
  }

  // Null covers revoked, rotated and never-existed alike — a withdrawn link
  // must not be distinguishable from a wrong one.
  const parsed = feedSchema.safeParse(data);
  if (!parsed.success) {
    return plain(
      "This MeOS calendar link isn't valid any more. Open MeOS → You → Calendar to get a new one.",
      404,
    );
  }

  const body = buildIcsCalendar(parsed.data, new Date());

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="meos.ics"',
      // The URL is a secret; nothing in front of it should keep a copy.
      "Cache-Control": "no-store, private",
    },
  });
}
