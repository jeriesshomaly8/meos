import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { apiError, checkRateLimit } from "@/lib/api";
import { CAPTURE_MAX_CHARS } from "@/lib/capture/limits";

/**
 * The capture-from-anywhere endpoint (§v2.1): an iOS Shortcut POSTs dictated
 * text here and it lands in the inbox as a *pending* entry — never in memory.
 * The user reviews it through the ordinary analyze → confirm → save flow next
 * time they open MeOS.
 *
 * Unauthenticated by construction (a Shortcut has no session); the token in
 * the path is the credential, resolved inside a security-definer function
 * whose only power is inserting into that token's own inbox. A wrong token
 * and a revoked token get the same 404 — telling a prober which it found is
 * free information about who has capture on.
 */

const bodySchema = z
  .object({
    text: z.string().trim().min(1).max(CAPTURE_MAX_CHARS),
  })
  .strict();

/** Generous for a human dictating, hostile to a script hammering a token. */
const CAPTURE_LIMIT = 30;
const CAPTURE_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!/^[0-9a-f]{64}$/.test(token)) {
    return apiError("INVALID_INPUT", "Nothing lives at this address.", 404);
  }

  const rate = checkRateLimit(token, "capture", CAPTURE_LIMIT, CAPTURE_WINDOW_MS);
  if (!rate.allowed) {
    return apiError("RATE_LIMITED", "Too many captures — give it a little while.", 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_INPUT", 'Send JSON like {"text": "what to remember"}.', 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError("INVALID_INPUT", 'Send JSON like {"text": "what to remember"}.', 400);
  }

  const supabase = await createClient();
  const { data: accepted, error } = await supabase.rpc("capture_by_token", {
    p_token: token,
    p_text: parsed.data.text,
  });

  if (error) {
    return apiError("INTERNAL_ERROR", "Couldn't take that down. Try again.", 500);
  }
  if (!accepted) {
    return apiError("INVALID_INPUT", "Nothing lives at this address.", 404);
  }

  // The message is what Siri reads back — it should sound like an answer.
  return NextResponse.json({ ok: true, message: "Got it — waiting in MeOS for your review." });
}
