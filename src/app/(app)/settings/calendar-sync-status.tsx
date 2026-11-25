import { CalendarX2 } from "lucide-react";
import { calendarProviders } from "@/lib/calendar/provider";

/**
 * The honest half of the provider registry: says what does NOT sync and why,
 * on the surface where someone would go looking for it (§6.1 corollary 3).
 * The available provider renders through its own card above; this only lists
 * the missing ones, so it disappears entirely the day they exist.
 */
export function CalendarSyncStatus({ feedToken }: { feedToken: string | null }) {
  const missing = calendarProviders({ feedToken }).filter((provider) => !provider.available);
  if (missing.length === 0) return null;

  return (
    <>
      {missing.map((provider) => (
        <div key={provider.key} className="flex flex-col gap-1 rounded-lg bg-card p-4 shadow-card">
          <p className="flex items-start gap-2.5 text-base text-muted-foreground">
            <CalendarX2 className="mt-0.5 size-4.5 shrink-0" aria-hidden />
            <span>
              <strong className="font-medium text-foreground">{provider.name}</strong> —{" "}
              {provider.unavailableReason}
            </span>
          </p>
        </div>
      ))}
    </>
  );
}
