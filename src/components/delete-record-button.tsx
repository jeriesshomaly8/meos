"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteRecord } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface DeleteRecordButtonProps {
  table: string;
  id: string;
  /** What is being deleted, e.g. "Sarah" or "this note". */
  label: string;
  /** Navigate here after deleting (for detail pages). */
  redirectTo?: string;
}

export function DeleteRecordButton({ table, id, label, redirectTo }: DeleteRecordButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    setBusy(true);
    const result = await deleteRecord(table, id);
    setBusy(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success("Deleted.");
    setOpen(false);
    if (redirectTo) {
      router.push(redirectTo);
    }
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Quiet by default, 44px hit area regardless — destructive actions
          shouldn't advertise themselves, but they still have to be tappable. */}
      <DialogTrigger
        aria-label={`Delete ${label}`}
        className="flex size-11 items-center justify-center rounded-full text-muted-foreground/50 transition-colors active:bg-destructive/10 active:text-destructive"
      >
        <Trash2 className="size-4.5" aria-hidden />
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete {label}?</DialogTitle>
          <DialogDescription>This can&apos;t be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={handleDelete} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
