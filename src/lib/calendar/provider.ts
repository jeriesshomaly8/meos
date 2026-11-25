/**
 * Calendar sync providers (§Phase 5).
 *
 * An interface with one real implementation is usually speculation; this one
 * exists to make the *absence* of the second implementation honest. The ICS
 * feed is what MeOS can do today; Google Calendar is what people expect and
 * what §6.2 row H defers, because its OAuth verification costs more than
 * every shipped integration combined. Declaring both here means the settings
 * screen states that, instead of the feature just not being anywhere.
 */

export interface CalendarProvider {
  key: "ics-feed" | "google";
  name: string;
  /** What syncs, which way, and the lag — stated on the surface that uses it. */
  limits: string;
  /** Whether this app can offer the provider at all, ever, as deployed. */
  available: boolean;
  /** Whether this user has it turned on. Always false while unavailable. */
  configured: boolean;
  /** The honest sentence shown while unavailable. */
  unavailableReason: string | null;
}

export function calendarProviders(state: { feedToken: string | null }): CalendarProvider[] {
  return [
    {
      key: "ics-feed",
      name: "Calendar feed",
      limits:
        "One-way, out of MeOS only. Your calendar app decides how often it refreshes — roughly hourly on iPhone, sometimes much longer elsewhere.",
      available: true,
      configured: state.feedToken !== null,
      unavailableReason: null,
    },
    {
      key: "google",
      name: "Google Calendar",
      limits: "Two-way sync, near-instant, reads existing events back.",
      available: false,
      configured: false,
      unavailableReason:
        "Not built yet. Two-way sync needs Google's OAuth verification process, and the calendar feed above covers getting your dates out in the meantime.",
    },
  ];
}
