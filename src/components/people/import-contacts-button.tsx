"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookUser, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { importContacts } from "@/app/(app)/actions";
import {
  normaliseContactNames,
  pickContactNames,
  supportsContactPicker,
} from "@/lib/contacts/picker";
import { Button } from "@/components/ui/button";

/** Capability, not state: nothing to subscribe to, and it never changes. */
const noopSubscribe = () => () => {};
const isSupportedOnServer = () => false;

/**
 * "Add from contacts" — the OS picker, not an address-book permission.
 *
 * Absent rather than disabled off Chrome-Android, the same rule the mic button
 * follows: an affordance that can never work is worse than none at all.
 */
export function ImportContactsButton({ existingNames }: { existingNames: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picking, setPicking] = useState(false);
  const supported = useSyncExternalStore(
    noopSubscribe,
    supportsContactPicker,
    isSupportedOnServer,
  );

  if (!supported) return null;

  async function pick() {
    setPicking(true);
    let names: string[];
    try {
      names = await pickContactNames();
    } catch {
      // Thrown when the browser refuses the picker — no gesture, an insecure
      // origin, or a picker already open. None of those are the user's fault.
      toast.error("Your phone wouldn't open the contact picker. Try again from this screen.");
      return;
    } finally {
      setPicking(false);
    }

    const fresh = normaliseContactNames(names, existingNames);
    if (fresh.length === 0) {
      toast.info(
        names.length > 0
          ? "Everyone you picked is already in MeOS."
          : "Nobody was picked, so nothing was added.",
      );
      return;
    }

    startTransition(async () => {
      const result = await importContacts(fresh);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.added === 1 ? "Added 1 person" : `Added ${result.added} people`,
      );
      router.refresh();
    });
  }

  const busy = picking || pending;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-card p-4 shadow-card">
      <Button type="button" disabled={busy} onClick={() => void pick()}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <BookUser aria-hidden />}
        Add from contacts
      </Button>
      {/* The limit, on the surface that carries it: what MeOS receives, and
          that this is a one-off copy rather than a link to the address book. */}
      <p className="text-xs text-muted-foreground">
        Your phone shows the picker. MeOS only ever receives the names you tick — no numbers, no
        emails — and it copies them once rather than syncing.
      </p>
    </div>
  );
}
