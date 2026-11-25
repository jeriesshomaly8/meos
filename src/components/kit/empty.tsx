import type { LucideIcon } from "lucide-react";

interface EmptyProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}

/**
 * Zero-data state. Deliberately a real card rather than a dashed outline —
 * a dashed box says "developer placeholder"; a card with a soft icon says
 * "there's nothing here yet, and that's fine."
 *
 * Distinct from the no-search-match state, which lives in `EmptySearch`.
 */
export function Empty({ icon: Icon, title, description, action }: EmptyProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg bg-card px-6 py-12 text-center shadow-card">
      <span className="flex size-14 items-center justify-center rounded-xl bg-secondary text-muted-foreground/70">
        <Icon className="size-6.5" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <p className="font-display text-lg">{title}</p>
        <p className="mx-auto max-w-[34ch] text-balance text-base text-muted-foreground">
          {description}
        </p>
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** No results for a query — never show the zero-data copy here. */
export function EmptySearch({ query }: { query: string }) {
  return (
    <div className="rounded-lg bg-card px-6 py-10 text-center shadow-card">
      <p className="text-base text-muted-foreground">
        Nothing matches <span className="font-medium text-foreground">“{query}”</span>
      </p>
    </div>
  );
}
