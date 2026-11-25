import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from "@/lib/supabase/config";

/*
 * `/share` and `/calendar` are public for opposite reasons:
 *
 *   * `/share` receives a POST from the OS share sheet. Redirecting that to
 *     /login would preserve the method and POST at a page that only answers
 *     GET; the route bounces to `/`, which the redirect below still gates.
 *   * `/calendar/<token>/feed.ics` is fetched by a calendar client that has no
 *     way to log in. Its long random token *is* the credential, and the feed
 *     itself is resolved by a security-definer function scoped to that token.
 *   * `/manifest.webmanifest` is fetched with credentials *omitted* unless the
 *     link tag carries `crossorigin="use-credentials"`, so gating it 307s the
 *     manifest to /login even for a signed-in user and the app stops being
 *     installable — no prompt, no standalone, no share target. It holds only
 *     the app's name, icons and share target, so there is nothing to gate.
 *   * `/sw.js` is fetched by the browser's service-worker installer, not by a
 *     page, and that request carries no session either. A redirected worker
 *     script fails to register, so push would never arrive. It contains no
 *     user data — only how to display a notification.
 *   * `/api/push/send` is called by the alarm scheduler (pg_cron), which has
 *     no session by construction. It authenticates itself with a bearer
 *     secret checked inside the route; a 307 to /login here would silently
 *     end every alarm push.
 *   * `/api/capture` is posted to by the user's own Shortcut, which has no
 *     session either — the token in the path is the credential, resolved by
 *     a security-definer function that can only insert into that token's
 *     inbox.
 */
const PUBLIC_PATHS = [
  "/login",
  "/auth",
  "/privacy",
  "/share",
  "/calendar",
  "/api/push/send",
  "/api/capture",
];
const PUBLIC_FILES = ["/manifest.webmanifest", "/sw.js"];

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_FILES.includes(pathname)) return true;
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refreshes the Supabase session on every request and gates the app behind
 * authentication. Next 16 proxy (nodejs runtime) — the middleware.ts
 * convention is deprecated.
 */
export async function proxy(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    // Let pages render their "Supabase not configured" notice.
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // Do not run code between createServerClient and getUser() — the token
  // refresh must happen before any decision is made.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Everything except static assets and images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
