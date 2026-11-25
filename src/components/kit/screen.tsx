import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Every screen's outer wrapper. Owns the one gutter value in the app and the
 * bottom clearance for the tab bar, so no screen has to remember either.
 */
export function Screen({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-2xl flex-col gap-6 px-4",
        // Tab bar (64) + safe area + breathing room. Content that ends flush
        // against a floating bar reads as cut off.
        "pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pb-32",
        className,
      )}
      {...props}
    />
  );
}

interface ScreenHeaderProps {
  title: string;
  /** Sits above the title in small caps — the screen's parent, or the date. */
  eyebrow?: string;
  description?: string;
  /** Renders a back chevron pointing here. Omit on tab roots. */
  backHref?: string;
  backLabel?: string;
  action?: React.ReactNode;
}

export function ScreenHeader({
  title,
  eyebrow,
  description,
  backHref,
  backLabel = "Back",
  action,
}: ScreenHeaderProps) {
  return (
    <header className="flex flex-col gap-1 pt-6">
      {backHref && (
        <Link
          href={backHref}
          className="-ms-1.5 mb-1 inline-flex w-fit items-center gap-0.5 rounded-xs py-1 pe-2 text-base font-medium text-primary transition-opacity active:opacity-60"
        >
          <ChevronLeft className="size-4.5" aria-hidden />
          {backLabel}
        </Link>
      )}
      {eyebrow && (
        <p className="text-2xs font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          {eyebrow}
        </p>
      )}
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-balance font-display text-3xl">{title}</h1>
        {action && <div className="shrink-0 pt-1.5">{action}</div>}
      </div>
      {description && <p className="text-base text-muted-foreground">{description}</p>}
    </header>
  );
}
