"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BROWSE_CATEGORIES, CATEGORY_META } from "@/lib/categories";
import { cn } from "@/lib/utils";

const ALL = { label: "All", href: "/memory" };
/*
 * §1.7: the rail cannot grow past ~8 chips without becoming an unusable
 * horizontal scroll, and custom types make the list open-ended. So the rail
 * stays a fixed set and everything else lives one tap away, rather than the
 * rail growing until nobody can find anything in it.
 */
const MORE = { label: "All types", href: "/types" };

/**
 * The category filter rail — the answer to "where did my thing go?".
 *
 * Categories are filters, not destinations: the same rail is pinned to the
 * top of every browse screen, so switching between People and Notes is one
 * thumb tap in a fixed position rather than a trip through a nav menu.
 * These are real links (each category screen owns its own behaviour), but
 * with prefetch they behave like a segmented control.
 */
export function CategoryRail() {
  const pathname = usePathname();

  const items = [
    ALL,
    ...BROWSE_CATEGORIES.map((c) => ({
      label: CATEGORY_META[c].chipLabel,
      href: CATEGORY_META[c].href,
    })),
    MORE,
  ];

  return (
    <nav aria-label="Browse by category">
      {/* Negative margin lets chips bleed to the screen edge while the page
          keeps its gutter — a rail that stops short reads as clipped. */}
      <ul className="rail -mx-4 gap-2 px-4 py-0.5">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center rounded-full px-4 text-base font-medium transition-colors duration-150",
                  active
                    ? "bg-foreground text-background"
                    : "bg-card text-muted-foreground shadow-card active:bg-secondary",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
