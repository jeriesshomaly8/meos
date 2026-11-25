import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { SupabaseNotConfigured } from "@/components/supabase-not-configured";
import { TabBar } from "@/components/app-shell/tab-bar";
import { AlarmScheduler } from "@/components/alarms/alarm-scheduler";
import { ServiceWorkerRegistrar } from "@/components/alarms/service-worker-registrar";

/**
 * One column, one bottom bar, no chrome. There is deliberately no sidebar or
 * top nav at any breakpoint: the app is a phone app that happens to also run
 * on a laptop, so the wide layout is the same column with more air around it
 * rather than a second, desktop-shaped information architecture to maintain.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) {
    return <SupabaseNotConfigured />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-dvh w-full flex-col">
      <main className="flex-1">{children}</main>
      <TabBar />
      <AlarmScheduler />
      <ServiceWorkerRegistrar />
    </div>
  );
}
