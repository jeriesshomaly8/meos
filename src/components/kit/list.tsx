import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Grouped list — the workhorse of the app.
 *
 * One white card holds many rows, separated by hairlines that are inset to
 * the text column. This is the iOS/Android grouped-list convention, and it's
 * why the app reads as native rather than as a stack of web cards: related
 * rows form a single object instead of N floating boxes.
 */
export function List({
  children,
  className,
  ...props
}: React.ComponentProps<"ul"> & { children: React.ReactNode }) {
  return (
    <ul
      className={cn("overflow-hidden rounded-lg bg-card shadow-card", className)}
      {...props}
    >
      {children}
    </ul>
  );
}

const ICON_COLUMN = "calc(var(--spacing) * 4 + 2.5rem + var(--spacing) * 3)";

interface ListRowProps {
  icon?: LucideIcon;
  /** Tailwind classes for the icon chip, e.g. `bg-cat-person/10 text-cat-person`. */
  iconClassName?: string;
  /** Replaces the icon chip entirely — for avatars. */
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right-aligned content: a countdown, a badge, a count. */
  trailing?: React.ReactNode;
  href?: string;
  className?: string;
}

/**
 * A single row. Renders as a link when `href` is given, otherwise as static
 * content — never as a div with a click handler, so keyboard and screen
 * reader users get the affordance for free.
 */
export function ListRow({
  icon: Icon,
  iconClassName,
  leading,
  title,
  subtitle,
  trailing,
  href,
  className,
}: ListRowProps) {
  const hasLeading = Boolean(Icon || leading);

  const inner = (
    <>
      {leading ??
        (Icon && (
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-md",
              iconClassName ?? "bg-secondary text-muted-foreground",
            )}
          >
            <Icon className="size-5" aria-hidden />
          </span>
        ))}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {subtitle && (
          <span className="mt-0.5 block truncate text-sm text-muted-foreground">{subtitle}</span>
        )}
      </span>
      {trailing && <span className="shrink-0">{trailing}</span>}
      {href && (
        <ChevronRight className="size-4.5 shrink-0 text-muted-foreground/50" aria-hidden />
      )}
    </>
  );

  const rowClass = cn(
    "flex min-h-[3.5rem] items-center gap-3 px-4 py-3",
    // Hairline lives on the row, inset to the text column so the icon
    // gutter stays clean. `after` rather than border-top: a border would
    // clip against the card's rounded corners.
    "relative after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-hairline",
    "first:after:hidden",
    className,
  );

  return (
    <li
      className="group/row"
      style={hasLeading ? ({ "--row-inset": ICON_COLUMN } as React.CSSProperties) : undefined}
    >
      {href ? (
        <Link
          href={href}
          className={cn(
            rowClass,
            "transition-colors active:bg-secondary/70 hover:bg-secondary/40",
            hasLeading && "after:start-[var(--row-inset)]",
          )}
        >
          {inner}
        </Link>
      ) : (
        <div className={cn(rowClass, hasLeading && "after:start-[var(--row-inset)]")}>{inner}</div>
      )}
    </li>
  );
}
