import type { MetadataRoute } from "next";

/**
 * Makes MeOS installable to the home screen.
 *
 * `display: standalone` is the line that removes the browser chrome — without
 * it the tab bar sits above Safari's toolbar and the app reads as a website.
 * On iOS this also unlocks Web Push, which only works for installed web apps.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MeOS — your private memory",
    short_name: "MeOS",
    description: "A private place for everything you'd rather not forget.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Matches --background so the splash screen doesn't flash a different
    // colour before the first paint.
    background_color: "#faf7f2",
    theme_color: "#faf7f2",
    categories: ["productivity", "lifestyle", "utilities"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android crops icons to its own shape; the maskable variant keeps the
      // wordmark inside the safe zone so it never gets a slice taken off.
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Ask MeOS", short_name: "Ask", url: "/ask" },
      { name: "Memory", short_name: "Memory", url: "/memory" },
    ],
    /*
     * Puts MeOS in the Android share sheet, so anything readable in another app
     * can be captured without retyping it. POST + multipart is the only
     * combination that carries a long body; a GET share target would put the
     * shared text in a URL and lose anything past the browser's length limit.
     *
     * Android and Chromium only, and only once installed to the home screen —
     * iOS ignores `share_target` entirely.
     */
    share_target: {
      action: "/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: { title: "title", text: "text", url: "url" },
    },
  };
}
