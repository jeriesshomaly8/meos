import { NextResponse } from "next/server";
import { SHARED_TEXT_PARAM, composeSharedText } from "@/lib/share/shared-text";

/**
 * Where the OS share sheet delivers text shared into MeOS.
 *
 * Declared as the manifest's `share_target`, so an installed Android PWA shows
 * up in every app's share sheet. This handler stores nothing: it folds the
 * three fields into one string and bounces to the capture sheet with it
 * prefilled, which means a share goes through the same analyze → confirm →
 * save path as typing, and nothing reaches the database without the user
 * seeing it first.
 *
 * 303 rather than the default 307 on purpose — the browser must turn a POST
 * into a GET of the home screen, not re-post to it.
 *
 * Public in the proxy because the *POST* must reach this route: a signed-out
 * share would otherwise be redirected to /login with its method preserved and
 * arrive as a POST at a page that only answers GET. Nothing is exposed by
 * that — the redirect target is gated as usual, so a signed-out share lands on
 * the login screen.
 */
export async function POST(request: Request) {
  const home = new URL("/", request.url);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // A share with an unreadable body still opens the app rather than an
    // error page; the user can type what they meant to send.
    return NextResponse.redirect(home, 303);
  }

  const shared = composeSharedText({
    title: form.get("title")?.toString(),
    text: form.get("text")?.toString(),
    url: form.get("url")?.toString(),
  });

  if (shared) {
    home.searchParams.set(SHARED_TEXT_PARAM, shared);
  }

  return NextResponse.redirect(home, 303);
}
