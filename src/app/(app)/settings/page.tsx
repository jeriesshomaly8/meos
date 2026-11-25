import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { initials } from "@/lib/initials";
import { Screen, ScreenHeader } from "@/components/kit/screen";
import { Section } from "@/components/kit/section";
import { ProfileForm } from "./profile-form";
import { AccountSection } from "./account-section";
import { AlarmHandoffSection } from "./alarm-handoff-section";
import { CaptureToken } from "./capture-token";
import { PushAlarmsSection } from "./push-alarms-section";
import { CalendarFeed } from "./calendar-feed";
import { CalendarSyncStatus } from "./calendar-sync-status";
import { DangerZone } from "./danger-zone";

export const metadata: Metadata = { title: "Settings" };

/**
 * The origin a calendar client would fetch from.
 *
 * Read off the request rather than an env var: the feed URL has to be
 * absolute, and this app is served from localhost, a tunnel and a deployment
 * in turn — a hardcoded origin would be wrong on two of the three.
 */
async function requestOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const protocol = headerList.get("x-forwarded-proto") ?? "https";
  return host ? `${protocol}://${host}` : "";
}

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: profile }, { data: feed }, { data: capture }, origin] = await Promise.all([
    supabase.from("profiles").select("display_name, timezone").eq("id", user!.id).maybeSingle(),
    supabase.from("calendar_feeds").select("token, last_fetched_at").maybeSingle(),
    supabase.from("capture_tokens").select("token, last_used_at").maybeSingle(),
    requestOrigin(),
  ]);

  const displayName =
    (profile?.display_name as string | null) ?? user?.email?.split("@")[0] ?? "You";
  const email = user?.email ?? "";

  return (
    <Screen>
      <ScreenHeader title="You" />

      <div className="flex items-center gap-3.5 rounded-lg bg-card p-4 shadow-card">
        <span
          aria-hidden
          className="flex size-13 shrink-0 items-center justify-center rounded-full bg-primary/12 font-display text-xl text-primary"
        >
          {initials(displayName)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-lg font-medium">{displayName}</p>
          <p className="truncate text-base text-muted-foreground">{email}</p>
        </div>
      </div>

      <Section title="Profile">
        <div className="rounded-lg bg-card p-4 shadow-card">
          <ProfileForm
            initialDisplayName={(profile?.display_name as string | null) ?? ""}
            initialTimezone={(profile?.timezone as string | null) ?? "UTC"}
            email={email}
          />
        </div>
      </Section>

      <Section title="Appearance & account">
        <AccountSection />
      </Section>

      <Section title="Capture">
        <CaptureToken
          token={(capture?.token as string | null) ?? null}
          origin={origin}
          lastUsedAt={(capture?.last_used_at as string | null) ?? null}
        />
      </Section>

      <Section title="Alarms">
        <PushAlarmsSection />
        <AlarmHandoffSection />
      </Section>

      <Section title="Calendar">
        <CalendarFeed
          token={(feed?.token as string | null) ?? null}
          origin={origin}
          lastFetchedAt={(feed?.last_fetched_at as string | null) ?? null}
        />
        <CalendarSyncStatus feedToken={(feed?.token as string | null) ?? null} />
      </Section>

      <Section title="Privacy">
        <div className="flex flex-col gap-3 rounded-lg bg-card p-4 shadow-card">
          <p className="flex items-start gap-2.5 text-base text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4.5 shrink-0 text-success" aria-hidden />
            <span>
              Everything you save is private to your account and protected by row-level security.
              AI analysis runs server-side; only the text you submit is sent to the AI provider.
            </span>
          </p>
          <Link
            href="/privacy"
            className="flex items-center justify-between rounded-md py-1 text-base font-medium text-primary transition-opacity active:opacity-60"
          >
            Read the full privacy overview
            <ChevronRight className="size-4.5" aria-hidden />
          </Link>
        </div>
      </Section>

      <DangerZone />
    </Screen>
  );
}
