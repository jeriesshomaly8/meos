import { Database } from "lucide-react";

/**
 * Rendered instead of app content while Supabase credentials are missing.
 * Development aid only — a configured deployment never shows this.
 */
export function SupabaseNotConfigured() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
        <Database className="size-7" aria-hidden />
      </div>
      <h1 className="text-2xl font-semibold">MeOS isn&apos;t connected yet</h1>
      <p className="max-w-md text-balance text-muted-foreground">
        Supabase credentials are missing. Copy <code className="font-mono">.env.example</code> to{" "}
        <code className="font-mono">.env.local</code>, fill in your Supabase URL and anon key, then
        restart the dev server. The README walks through it step by step.
      </p>
    </main>
  );
}
