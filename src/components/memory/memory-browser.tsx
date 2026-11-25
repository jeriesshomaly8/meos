"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Search, Sparkles, X } from "lucide-react";
import { CATEGORY_META, type ExtractionCategory } from "@/lib/categories";
import { List, ListRow } from "@/components/kit/list";
import { Empty, EmptySearch } from "@/components/kit/empty";

export interface MemoryItem {
  id: string;
  category: ExtractionCategory;
  title: string;
  subtitle: string;
  href: string;
  createdAt: string;
}

/**
 * Search over everything at once — the point of the Memory tab. The user
 * recalls "something about Dana's allergy", not "the food_preferences table",
 * so one field searches titles and subtitles across every category.
 */
export function MemoryBrowser({
  items,
  truncated,
}: {
  items: MemoryItem[];
  truncated: boolean;
}) {
  const [query, setQuery] = useState("");
  // Keeps typing responsive when the list is long: the input updates on every
  // keystroke, the filtered list catches up.
  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(needle) ||
        item.subtitle.toLowerCase().includes(needle) ||
        CATEGORY_META[item.category].label.toLowerCase().includes(needle),
    );
  }, [items, deferredQuery]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-3.5 top-1/2 size-4.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <label htmlFor="memory-search" className="sr-only">
          Search your memory
        </label>
        <input
          id="memory-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search everything…"
          // `search` inputs render a UA clear button in WebKit that ignores
          // our styling; ours is below and matches the design.
          className="h-12 w-full rounded-lg bg-card ps-11 pe-11 text-base shadow-card outline-none placeholder:text-muted-foreground/70 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute end-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-secondary"
          >
            <X className="size-4.5" aria-hidden />
          </button>
        )}
      </div>

      <p className="sr-only" role="status">
        {filtered.length} {filtered.length === 1 ? "result" : "results"}
      </p>

      {items.length === 0 ? (
        <Empty
          icon={Sparkles}
          title="Nothing saved yet"
          description="Tap the + button and tell MeOS something worth keeping. It'll sort out where it belongs."
        />
      ) : filtered.length === 0 ? (
        <EmptySearch query={query.trim()} />
      ) : (
        <List>
          {filtered.map((item) => {
            const meta = CATEGORY_META[item.category];
            return (
              <ListRow
                key={item.id}
                icon={meta.icon}
                iconClassName={meta.chipClass}
                title={item.title}
                subtitle={item.subtitle}
                href={item.href}
              />
            );
          })}
        </List>
      )}

      {truncated && (
        <p className="px-1 text-xs text-muted-foreground">
          Showing your most recent entries. Older ones are still on their category screens.
        </p>
      )}
    </div>
  );
}
