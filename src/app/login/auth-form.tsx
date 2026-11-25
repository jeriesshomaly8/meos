"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, MailCheck, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const credentialsSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type Credentials = z.infer<typeof credentialsSchema>;
type Mode = "sign-in" | "sign-up";

/** Maps Supabase auth errors to friendly copy without leaking internals. */
function friendlyAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) {
    return "That email and password don't match. Try again, or create an account.";
  }
  if (/already registered/i.test(message)) {
    return "An account with this email already exists — try signing in instead.";
  }
  if (/rate limit/i.test(message)) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  return "Something went wrong signing you in. Please try again.";
}

const fieldClass =
  "h-13 w-full rounded-lg bg-card px-4 text-base shadow-card outline-none transition-shadow placeholder:text-muted-foreground/60 focus-visible:outline-2 focus-visible:outline-ring aria-invalid:ring-1 aria-invalid:ring-destructive";

/**
 * One form, one mode switch. The previous version shipped two structurally
 * identical forms inside tab panels — same fields, same validation, twice the
 * code and twice the places to forget an aria attribute.
 */
export function AuthForm({ next, callbackFailed }: { next: string; callbackFailed: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [serverError, setServerError] = useState<string | null>(
    callbackFailed ? "That sign-in link is invalid or expired. Please try again." : null,
  );
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const form = useForm<Credentials>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: Credentials) {
    setServerError(null);
    const supabase = createClient();

    if (mode === "sign-in") {
      const { error } = await supabase.auth.signInWithPassword(values);
      if (error) {
        setServerError(friendlyAuthError(error.message));
        return;
      }
    } else {
      const { data, error } = await supabase.auth.signUp({
        ...values,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) {
        setServerError(friendlyAuthError(error.message));
        return;
      }
      if (!data.session) {
        setAwaitingConfirmation(true);
        return;
      }
    }

    router.push(next);
    router.refresh();
  }

  if (awaitingConfirmation) {
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-3 rounded-lg bg-card px-6 py-10 text-center shadow-card"
      >
        <span className="flex size-14 items-center justify-center rounded-xl bg-success/12 text-success">
          <MailCheck className="size-6.5" aria-hidden />
        </span>
        <p className="font-display text-lg">Check your email</p>
        <p className="text-base text-muted-foreground">
          We sent a confirmation link. Open it to finish creating your account.
        </p>
      </div>
    );
  }

  const errors = form.formState.errors;

  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Mode" className="flex gap-1 rounded-lg bg-secondary p-1">
        {(
          [
            { value: "sign-in", label: "Sign in" },
            { value: "sign-up", label: "Create account" },
          ] as const
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={mode === option.value}
            onClick={() => {
              setMode(option.value);
              setServerError(null);
            }}
            className={cn(
              "h-10 flex-1 rounded-md text-base font-medium transition-colors duration-150",
              mode === option.value
                ? "bg-card text-foreground shadow-card"
                : "text-muted-foreground active:bg-card/50",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {serverError && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2.5 text-base text-destructive"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{serverError}</span>
        </p>
      )}

      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3" noValidate>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="auth-email" className="ps-1 text-sm font-medium text-muted-foreground">
            Email
          </label>
          <input
            id="auth-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "auth-email-error" : undefined}
            className={fieldClass}
            {...form.register("email")}
          />
          {errors.email && (
            <p id="auth-email-error" className="ps-1 text-sm text-destructive">
              {errors.email.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="auth-password" className="ps-1 text-sm font-medium text-muted-foreground">
            Password
          </label>
          <input
            id="auth-password"
            type="password"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            placeholder={mode === "sign-up" ? "At least 8 characters" : "••••••••"}
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? "auth-password-error" : undefined}
            className={fieldClass}
            {...form.register("password")}
          />
          {errors.password && (
            <p id="auth-password-error" className="ps-1 text-sm text-destructive">
              {errors.password.message}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={form.formState.isSubmitting}
          aria-busy={form.formState.isSubmitting}
          className="mt-2 flex h-13 items-center justify-center gap-2 rounded-lg bg-primary text-body font-semibold text-primary-foreground shadow-accent transition-transform duration-150 active:scale-[0.985] disabled:opacity-60"
        >
          {form.formState.isSubmitting && (
            <Loader2 className="size-4.5 animate-spin" aria-hidden />
          )}
          {mode === "sign-in" ? "Sign in" : "Create account"}
        </button>
      </form>
    </div>
  );
}
