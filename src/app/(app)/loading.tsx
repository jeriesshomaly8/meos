import { Screen } from "@/components/kit/screen";

/**
 * Shaped like the Today screen it usually precedes — header, then two
 * grouped lists — so the page doesn't visibly reflow when data lands.
 */
export default function Loading() {
  return (
    <Screen aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-2 pt-6">
        <Pulse className="h-3 w-32 rounded-full" />
        <Pulse className="h-9 w-60 rounded-md" />
      </div>

      {[0, 1].map((block) => (
        <div key={block} className="flex flex-col gap-2.5">
          <Pulse className="ms-1 h-3 w-24 rounded-full" />
          <div className="overflow-hidden rounded-lg bg-card shadow-card">
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className="flex min-h-[3.5rem] items-center gap-3 px-4 py-3 not-first:border-t not-first:border-hairline"
              >
                <Pulse className="size-10 shrink-0 rounded-md" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Pulse className="h-3.5 w-2/5 rounded-full" />
                  <Pulse className="h-3 w-3/5 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Screen>
  );
}

function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse bg-foreground/8 ${className}`} />;
}
