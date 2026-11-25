"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { TAB_ITEMS, isTabActive } from "@/lib/nav";
import { SHARED_ENTRY_PARAM, SHARED_TEXT_PARAM } from "@/lib/share/shared-text";
import { cn } from "@/lib/utils";
import { CaptureSheet } from "@/components/inbox/capture-sheet";

/**
 * The whole navigation surface: four tabs and one capture button, all within
 * thumb reach at the bottom of the screen. Nothing important lives in a top
 * corner, because on a phone the top corners are the hardest place to reach.
 *
 * Capture is raised and the only saturated element in the bar — there is
 * exactly one primary action in this app, and it should look like it.
 */
export function TabBar() {
  const pathname = usePathname();
  const [capturing, setCapturing] = useState(false);
  const [shared, setShared] = useState("");
  const [sharedEntryId, setSharedEntryId] = useState<string | null>(null);
  /*
   * Bumped when a share arrives, which remounts the sheet with the shared text
   * as its initial state. Cheaper and more predictable than an effect syncing
   * a prop into state: there is no moment where the box holds one and the
   * prop says another.
   */
  const [sheetKey, setSheetKey] = useState(0);

  const [left, right] = [TAB_ITEMS.slice(0, 2), TAB_ITEMS.slice(2)];

  const openWithShared = useCallback((text: string, entryId: string | null) => {
    setShared(text);
    setSharedEntryId(entryId);
    setSheetKey((key) => key + 1);
    setCapturing(true);
  }, []);

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 sm:inset-x-auto sm:left-1/2 sm:bottom-5 sm:-translate-x-1/2"
      >
        <div
          className={cn(
            "safe-b border-t border-hairline bg-background/85 supports-backdrop-filter:backdrop-blur-lg",
            // On a wide screen the bar stops spanning the viewport and
            // becomes a floating pill — a full-width bar on desktop looks
            // like a phone UI that forgot where it was.
            "sm:rounded-full sm:border sm:bg-background/90 sm:px-2 sm:shadow-raised",
          )}
        >
          <ul className="mx-auto flex h-16 max-w-md items-stretch sm:h-15 sm:w-auto sm:max-w-none sm:gap-1">
            {left.map((tab) => (
              <Tab key={tab.href} tab={tab} pathname={pathname} />
            ))}

            <li className="relative flex-1 sm:w-20">
              <button
                type="button"
                onClick={() => setCapturing(true)}
                aria-label="Add a memory"
                className={cn(
                  "absolute -top-4 left-1/2 flex size-14 -translate-x-1/2 items-center justify-center",
                  "rounded-full bg-primary text-primary-foreground shadow-accent",
                  "transition-transform duration-150 ease-[var(--ease-out-soft)]",
                  "active:scale-92 sm:-top-3 sm:size-13",
                )}
              >
                <Plus className="size-7" strokeWidth={2.25} aria-hidden />
              </button>
            </li>

            {right.map((tab) => (
              <Tab key={tab.href} tab={tab} pathname={pathname} />
            ))}
          </ul>
        </div>
      </nav>

      {/*
        useSearchParams suspends while the router settles, and the tab bar is
        rendered on every screen — a boundary here keeps a share from holding
        up navigation everywhere else.
      */}
      <Suspense fallback={null}>
        <SharedTextInbox onShared={openWithShared} />
      </Suspense>

      <CaptureSheet
        key={sheetKey}
        open={capturing}
        initialText={shared}
        initialEntryId={sharedEntryId}
        onOpenChange={(next) => {
          setCapturing(next);
          // Dropping the shared text on close is what makes discarding it
          // stick: without this, a later remount would seed it all over again.
          if (!next) {
            setShared("");
            setSharedEntryId(null);
          }
        }}
      />
    </>
  );
}

/**
 * Picks up text handed over by `/share` and opens capture with it.
 *
 * The share route can only reach the client through the URL, so it arrives as
 * a query parameter and is stripped again immediately — shared content has no
 * business sitting in the address bar or in history. Rendering nothing.
 */
function SharedTextInbox({
  onShared,
}: {
  onShared: (text: string, entryId: string | null) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const shared = searchParams.get(SHARED_TEXT_PARAM);
  // A Siri capture opened from Today carries its inbox entry beside the text.
  const entryId = searchParams.get(SHARED_ENTRY_PARAM);
  /** Guards against re-opening the sheet after the user closed it. */
  const consumed = useRef<string | null>(null);

  useEffect(() => {
    if (!shared) {
      // Params gone means the hand-off completed — clear the guard so tapping
      // the SAME waiting row again works (review finding: it used to be dead
      // for the rest of the page's lifetime).
      consumed.current = null;
      return;
    }
    if (consumed.current === shared) return;
    consumed.current = shared;
    onShared(shared, entryId);
    router.replace(pathname, { scroll: false });
  }, [entryId, onShared, pathname, router, shared]);

  return null;
}

function Tab({ tab, pathname }: { tab: (typeof TAB_ITEMS)[number]; pathname: string }) {
  const active = isTabActive(tab, pathname);
  const Icon = tab.icon;

  return (
    <li className="flex-1 sm:w-20">
      <Link
        href={tab.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-full flex-col items-center justify-center gap-1 text-2xs font-medium transition-colors duration-150",
          active ? "text-primary" : "text-muted-foreground",
        )}
      >
        <Icon
          className="size-6"
          strokeWidth={active ? 2.25 : 1.75}
          fill={active ? "currentColor" : "none"}
          fillOpacity={active ? 0.14 : 0}
          aria-hidden
        />
        {tab.label}
      </Link>
    </li>
  );
}
