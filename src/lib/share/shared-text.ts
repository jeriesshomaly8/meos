import { CAPTURE_MAX_CHARS } from "@/lib/capture/limits";

/**
 * What Android hands MeOS when the user shares something into it.
 *
 * A share arrives as up to three fields and every app fills them differently:
 * Chrome sends the page title plus the URL, a browser's "share link" sends the
 * URL in `text` *and* in `url`, and a messaging app sends a bare `text` with
 * neither. Joining them naively produces the same link twice and a title that
 * repeats the first line of the body.
 *
 * The result lands in the capture textarea, not in the database — the ordinary
 * analyze → confirm → save flow runs on it unchanged, ambiguity gate included.
 * So this never has to be clever, only faithful: the user sees exactly what
 * arrived before anything is saved.
 */

export const SHARED_TEXT_PARAM = "shared";

/**
 * The pending inbox entry a Siri capture is reviewed from. Travels beside the
 * text and is stripped from the URL the same way.
 */
export const SHARED_ENTRY_PARAM = "entry";

export interface SharePayload {
  title?: string | null;
  text?: string | null;
  url?: string | null;
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\r\n/g, "\n").trim();
}

export function composeSharedText(
  payload: SharePayload,
  maxChars: number = CAPTURE_MAX_CHARS,
): string {
  const title = clean(payload.title);
  const text = clean(payload.text);
  const url = clean(payload.url);

  const parts: string[] = [];
  if (title && title !== text && !text.startsWith(title)) parts.push(title);
  if (text) parts.push(text);
  // Dropped when the body already contains it, which is what a "share link"
  // from most browsers produces.
  if (url && !title.includes(url) && !text.includes(url)) parts.push(url);

  return parts.join("\n").slice(0, maxChars);
}
