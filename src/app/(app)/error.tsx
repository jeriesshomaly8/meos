"use client";

import { useEffect } from "react";
import { CircleAlert } from "lucide-react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Digest only — never log user content.
    console.error("[app] render error", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center gap-4 px-6 pb-28 text-center">
      <span className="flex size-14 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <CircleAlert className="size-7" aria-hidden />
      </span>
      {/*
        "Something went wrong" was named in the brief as banned, and it earns
        the ban: it tells the user nothing they hadn't worked out from the fact
        that they are looking at an error screen. What they actually want to
        know is whether they lost anything.
      */}
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl">This screen didn&apos;t load</h1>
        <p className="text-base text-muted-foreground">
          Nothing you saved was affected — the failure was in showing it, not in storing it. Try
          again, and if it keeps happening, sign out and back in.
        </p>
      </div>
      <button
        type="button"
        onClick={reset}
        className="mt-2 flex h-12 items-center justify-center rounded-lg bg-primary px-6 text-body font-semibold text-primary-foreground shadow-accent transition-transform duration-150 active:scale-[0.985]"
      >
        Try again
      </button>
    </div>
  );
}
