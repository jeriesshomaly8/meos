import Link from "next/link";
import { cn } from "@/lib/utils";

interface SectionProps {
  title: string;
  /** Optional "see all" target rendered at the end of the title row. */
  href?: string;
  linkLabel?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Titled block. The label is small, uppercase and quiet on purpose — it
 * orients without competing with the content underneath, which is where the
 * user's attention belongs.
 */
export function Section({ title, href, linkLabel = "See all", children, className }: SectionProps) {
  return (
    <section className={cn("flex flex-col gap-2.5", className)}>
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="font-sans text-2xs font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          {title}
        </h2>
        {href && (
          <Link
            href={href}
            className="rounded-xs text-xs font-medium text-primary transition-opacity active:opacity-60"
          >
            {linkLabel}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
