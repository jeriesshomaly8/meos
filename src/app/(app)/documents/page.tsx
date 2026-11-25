import type { Metadata } from "next";
import { IdCard } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { DocumentRow, ReminderRow } from "@/lib/types";
import { Screen, ScreenHeader } from "@/components/kit/screen";
import { CategoryRail } from "@/components/kit/category-rail";
import { Empty } from "@/components/kit/empty";
import { DocumentCard } from "./document-card";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage() {
  const supabase = await createClient();

  const [{ data: documents }, { data: reminders }] = await Promise.all([
    supabase
      .from("documents")
      .select(
        "id, document_type, display_name, document_number, issue_date, expiration_date, issuing_country, notes",
      )
      .order("expiration_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("reminders")
      .select("id, title, remind_at, completed, related_entity_type, related_entity_id")
      .eq("related_entity_type", "document")
      .eq("completed", false),
  ]);

  const documentRows = (documents ?? []) as Pick<
    DocumentRow,
    | "id"
    | "document_type"
    | "display_name"
    | "document_number"
    | "issue_date"
    | "expiration_date"
    | "issuing_country"
    | "notes"
  >[];
  const reminderRows = (reminders ?? []) as Pick<
    ReminderRow,
    "id" | "title" | "remind_at" | "completed" | "related_entity_type" | "related_entity_id"
  >[];

  return (
    <Screen>
      <ScreenHeader title="Documents" description="Your wallet, with the expiry dates watched." />
      <CategoryRail />

      {documentRows.length === 0 ? (
        <Empty
          icon={IdCard}
          title="No documents yet"
          description="Try “My driving licence expires in March 2027” — MeOS will start counting down."
        />
      ) : (
        /* Cards rather than list rows: a document carries a masked number, a
           status and its own reminders, which is more than a row can hold. */
        <ul className="flex flex-col gap-3">
          {documentRows.map((doc) => (
            <li key={doc.id}>
              <DocumentCard
                document={doc}
                reminders={reminderRows
                  .filter((r) => r.related_entity_id === doc.id)
                  .map((r) => ({ id: r.id, title: r.title, remindAt: r.remind_at }))}
              />
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
