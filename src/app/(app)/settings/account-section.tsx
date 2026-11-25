"use client";

import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { LogOut, Monitor, Moon, Sun } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Auto", icon: Monitor },
] as const;

/**
 * Appearance and sign-out used to live in a dropdown behind an avatar in the
 * sidebar. On a phone that's a hidden menu inside a hidden menu — they're
 * settings, so they live in Settings.
 */
export function AccountSection() {
  const router = useRouter();
  const { setTheme, theme } = useTheme();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        role="radiogroup"
        aria-label="Appearance"
        className="flex gap-1 rounded-lg bg-secondary p-1"
      >
        {THEMES.map((option) => {
          const Icon = option.icon;
          const active = theme === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(option.value)}
              className={cn(
                "flex h-10 flex-1 items-center justify-center gap-2 rounded-md text-base font-medium transition-colors duration-150",
                active
                  ? "bg-card text-foreground shadow-card"
                  : "text-muted-foreground active:bg-card/50",
              )}
            >
              <Icon className="size-4.5" aria-hidden />
              {option.label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={signOut}
        className="flex h-12 items-center justify-center gap-2 rounded-lg bg-card text-body font-medium text-destructive shadow-card transition-colors active:bg-destructive/10"
      >
        <LogOut className="size-4.5" aria-hidden />
        Sign out
      </button>
    </div>
  );
}
