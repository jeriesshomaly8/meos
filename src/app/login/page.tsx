import type { Metadata } from "next";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { SupabaseNotConfigured } from "@/components/supabase-not-configured";
import { AuthForm } from "./auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage(props: PageProps<"/login">) {
  if (!isSupabaseConfigured()) {
    return <SupabaseNotConfigured />;
  }

  const searchParams = await props.searchParams;
  const rawNext = typeof searchParams.next === "string" ? searchParams.next : "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  const callbackFailed = searchParams.error === "auth_callback_failed";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-9 px-6 py-12">
      {/* No logo mark. The product name set in the display face is the
          identity — a generic sparkle icon says "another AI app". */}
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-4xl">MeOS</h1>
        <p className="text-balance text-lg text-muted-foreground">
          A private place for everything you&apos;d rather not forget.
        </p>
      </header>

      <AuthForm next={next} callbackFailed={callbackFailed} />

      <p className="text-balance text-sm text-muted-foreground">
        Everything you save stays private to your account. MeOS never shares your information.
      </p>
    </main>
  );
}
