import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/proxy";

/**
 * The gate in front of every request. Getting an entry wrong fails in two
 * directions: too closed and an unauthenticated client that legitimately cannot
 * log in (a calendar app, the manifest fetcher) gets a login page instead of
 * what it asked for; too open and a screen leaks.
 */
describe("isPublicPath", () => {
  it("lets the unauthenticated surfaces through", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/privacy")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
    expect(isPublicPath("/share")).toBe(true);
    expect(isPublicPath("/calendar/abc123/feed.ics")).toBe(true);
  });

  it("gates everything else", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/memory")).toBe(false);
    expect(isPublicPath("/settings")).toBe(false);
    expect(isPublicPath("/people/some-id")).toBe(false);
    expect(isPublicPath("/alarm/some-id")).toBe(false);
    expect(isPublicPath("/api/save")).toBe(false);
  });

  /*
   * The regression this file was written for. Browsers fetch the manifest with
   * credentials omitted unless the link tag says otherwise, so a gated manifest
   * 307s to /login for a signed-in user too — and an app whose manifest does
   * not parse cannot be installed, which takes the share target with it.
   */
  it("leaves the manifest public so the app stays installable", () => {
    expect(isPublicPath("/manifest.webmanifest")).toBe(true);
  });

  /*
   * Same class of failure, different consumer: the service-worker installer
   * fetches /sw.js without a session, and a redirected worker script fails to
   * register — so push would never arrive and nothing would say why.
   */
  it("leaves the service worker public so push can register", () => {
    expect(isPublicPath("/sw.js")).toBe(true);
  });

  /*
   * The alarm scheduler is a cron job: no session, ever. It carries its own
   * bearer secret, which the route itself verifies — a 307 to /login here
   * would silently end every alarm push. Other /api/push routes stay gated;
   * they authenticate by session.
   */
  it("leaves the push sender public for the cron scheduler, and only the sender", () => {
    expect(isPublicPath("/api/push/send")).toBe(true);
    expect(isPublicPath("/api/push/subscribe")).toBe(false);
  });

  /*
   * The Shortcut posting a capture has no session; its token is its
   * credential, checked inside the route. Everything else under /api stays
   * gated.
   */
  it("leaves the capture endpoint public for the user's own shortcut", () => {
    expect(isPublicPath("/api/capture/abc123")).toBe(true);
    expect(isPublicPath("/api/analyze")).toBe(false);
  });

  /*
   * A prefix match on a bare filename would make every sibling public, and
   * `/manifest.webmanifest.evil` is the cheap way to prove it does not.
   */
  it("matches the manifest exactly rather than as a prefix", () => {
    expect(isPublicPath("/manifest.webmanifest/x")).toBe(false);
    expect(isPublicPath("/manifest.webmanifest.evil")).toBe(false);
  });

  /*
   * `/share` and `/calendar` are public path *prefixes*; a route that merely
   * starts with those letters is not.
   */
  it("does not treat a name that starts with a public path as public", () => {
    expect(isPublicPath("/shared-with-me")).toBe(false);
    expect(isPublicPath("/calendars")).toBe(false);
    expect(isPublicPath("/logins")).toBe(false);
  });
});
