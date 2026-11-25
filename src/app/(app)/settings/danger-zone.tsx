"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Trash2, UserX } from "lucide-react";
import { toast } from "sonner";
import { deleteAllMyData } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/kit/section";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CONFIRM_WORD = "DELETE";

function ConfirmDialog({
  triggerLabel,
  triggerIcon: TriggerIcon,
  title,
  description,
  actionLabel,
  onConfirm,
}: {
  triggerLabel: string;
  triggerIcon: typeof Trash2;
  title: string;
  description: string;
  actionLabel: string;
  onConfirm: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const inputId = `${title.replaceAll(/\s+/g, "-").toLowerCase()}-confirm`;

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setBusy(false);
      setConfirmation("");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirmation("");
      }}
    >
      <DialogTrigger render={<Button type="button" variant="destructive" />}>
        <TriggerIcon aria-hidden /> {triggerLabel}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor={inputId}>
            Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span> to confirm
          </Label>
          <Input
            id={inputId}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy || confirmation !== CONFIRM_WORD}
            onClick={handleConfirm}
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DangerZone() {
  const router = useRouter();

  async function handleDeleteAllData() {
    const result = await deleteAllMyData();
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success("All your data was deleted.");
    router.refresh();
  }

  async function handleDeleteAccount() {
    try {
      const response = await fetch("/api/account", { method: "DELETE" });
      const payload = (await response.json()) as
        | { deleted: boolean }
        | { error: { message: string } };
      if (!response.ok || "error" in payload) {
        toast.error("error" in payload ? payload.error.message : "Couldn't delete your account.");
        return;
      }
      router.push("/login");
      router.refresh();
    } catch {
      toast.error("Couldn't reach MeOS. Please try again.");
    }
  }

  return (
    <Section title="Your data">
      <div className="flex flex-col gap-4 rounded-lg bg-card p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">Export my data</p>
            <p className="text-sm text-muted-foreground">
              Download everything MeOS has saved for you as JSON.
            </p>
          </div>
          <Button variant="outline" render={<a href="/api/export" download />}>
            <Download aria-hidden /> Export
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
          <div className="min-w-0">
            <p className="font-medium">Delete all my data</p>
            <p className="text-sm text-muted-foreground">
              Removes every record but keeps your account.
            </p>
          </div>
          <ConfirmDialog
            title="Delete all your data"
            description="Every person, date, recipe, document, note and reminder will be permanently deleted. Your account stays."
            actionLabel="Delete everything"
            onConfirm={handleDeleteAllData}
            triggerLabel="Delete all data"
            triggerIcon={Trash2}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
          <div className="min-w-0">
            <p className="font-medium">Delete my account</p>
            <p className="text-sm text-muted-foreground">
              Deletes your account and all data. There is no way back.
            </p>
          </div>
          <ConfirmDialog
            title="Delete your account"
            description="Your account and every piece of data will be permanently deleted."
            actionLabel="Delete account"
            onConfirm={handleDeleteAccount}
            triggerLabel="Delete account"
            triggerIcon={UserX}
          />
        </div>
      </div>
    </Section>
  );
}
