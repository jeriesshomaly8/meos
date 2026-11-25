"use client";

import { useState } from "react";
import { format } from "date-fns";
import { BellRing, Eye, EyeOff, IdCard } from "lucide-react";
import { daysUntil, daysUntilLabel, expiryStatus, parseDateOnly } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { DeleteRecordButton } from "@/components/delete-record-button";

interface DocumentCardProps {
  document: {
    id: string;
    document_type: string;
    display_name: string;
    document_number: string | null;
    issue_date: string | null;
    expiration_date: string | null;
    issuing_country: string | null;
    notes: string | null;
  };
  reminders: { id: string; title: string; remindAt: string }[];
}

/** "X0000000" -> "••••0000" — sensitive numbers stay masked by default. */
function maskNumber(value: string): string {
  if (value.length <= 4) return "•".repeat(value.length);
  return "•".repeat(value.length - 4) + value.slice(-4);
}

const STATUS_STYLES = {
  expired: { badge: "bg-destructive text-white", label: "Expired" },
  expiring_soon: { badge: "bg-warning text-white", label: "Expiring soon" },
  expiring_later: { badge: "bg-secondary text-secondary-foreground", label: "Valid" },
  valid: { badge: "bg-success/15 text-success", label: "Valid" },
  unknown: { badge: "bg-secondary text-secondary-foreground", label: "No expiry saved" },
} as const;

export function DocumentCard({ document, reminders }: DocumentCardProps) {
  const [numberVisible, setNumberVisible] = useState(false);
  const status = expiryStatus(document.expiration_date);
  const statusStyle = STATUS_STYLES[status];
  const expiration = document.expiration_date ? parseDateOnly(document.expiration_date) : null;
  const days = expiration ? daysUntil(expiration) : null;

  return (
    <article className="flex flex-col gap-3 rounded-lg bg-card p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-cat-document/10 text-cat-document">
          <IdCard className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{document.display_name}</p>
          <p className="truncate text-sm text-muted-foreground">
            {document.document_type}
            {document.issuing_country && ` · ${document.issuing_country}`}
          </p>
        </div>
        <DeleteRecordButton table="documents" id={document.id} label={document.display_name} />
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
            statusStyle.badge,
          )}
        >
          {statusStyle.label}
        </span>
        {expiration && (
          <span className="text-sm text-muted-foreground">
            {status === "expired" ? "Expired" : "Expires"} {format(expiration, "d MMM yyyy")}
            {days !== null && days >= 0 && ` · ${daysUntilLabel(days)}`}
          </span>
        )}
      </div>

      {document.document_number && (
        <div className="flex items-center gap-2 rounded-md bg-secondary px-3 py-2">
          <span className="font-mono text-base tracking-wider" aria-label="Document number">
            {numberVisible ? document.document_number : maskNumber(document.document_number)}
          </span>
          <button
            type="button"
            className="ms-auto flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-background/70"
            aria-label={numberVisible ? "Hide document number" : "Show document number"}
            aria-pressed={numberVisible}
            onClick={() => setNumberVisible((v) => !v)}
          >
            {numberVisible ? (
              <EyeOff className="size-4.5" aria-hidden />
            ) : (
              <Eye className="size-4.5" aria-hidden />
            )}
          </button>
        </div>
      )}

      {(document.issue_date || reminders.length > 0) && (
        <div className="flex flex-col gap-1 border-t border-hairline pt-3">
          {document.issue_date && (
            <p className="text-sm text-muted-foreground">
              Issued {format(parseDateOnly(document.issue_date)!, "d MMM yyyy")}
            </p>
          )}
          {reminders.map((reminder) => (
            <p key={reminder.id} className="flex items-center gap-2 text-sm text-muted-foreground">
              <BellRing className="size-3.5 shrink-0 text-cat-reminder" aria-hidden />
              {reminder.title} — {format(new Date(reminder.remindAt), "d MMM yyyy")}
            </p>
          ))}
        </div>
      )}
    </article>
  );
}
