"use client";

import { useState } from "react";
import { Loader2, PencilLine } from "lucide-react";
import {
  dateAmbiguityOf,
  missingRequirementOf,
  resolvedDueAtOf,
  type DateChoice,
} from "@/lib/extraction/ambiguity";
import { describeItemsCapitalised } from "@/lib/extraction/describe";
import type { ExtractedItem } from "@/lib/extraction/schema";
import { SheetBody, SheetFooter } from "@/components/kit/sheet";
import { ItemCard } from "./item-card";

export interface EditableItem {
  item: ExtractedItem;
  included: boolean;
  /**
   * A person already in the user's data whose name matches this item.
   * Immutable — `useExistingPerson` is what the user toggles, so switching to
   * "create new" is reversible.
   */
  matchedPersonId: string | null;
  matchedPersonName: string | null;
  /** When true, save updates the matched person instead of creating one. */
  useExistingPerson: boolean;
  /**
   * The user's answer to an ambiguous date phrase, or null while the question
   * is still open. Saving waits for it rather than quietly storing no date,
   * which is what v1 did with "next Friday".
   */
  dateChoice: DateChoice | null;
}

/**
 * An item the user is keeping that still has an unanswered date question.
 *
 * A date typed into the card's own editor counts as an answer — otherwise
 * setting the due date by hand would leave the save button stuck with no
 * remaining way to unstick it.
 */
function isBlocked(entry: EditableItem): boolean {
  if (!entry.included || dateAmbiguityOf(entry.item) === null) return false;
  return entry.dateChoice === null && resolvedDueAtOf(entry.item) === null;
}

/** An item the user is keeping that is missing a value it cannot be saved without. */
function isIncomplete(entry: EditableItem): boolean {
  return entry.included && missingRequirementOf(entry.item) !== null;
}

interface ConfirmationPanelProps {
  items: EditableItem[];
  droppedCount: number;
  /** Cross-checks the analyze pass surfaced — a passport expiring near a trip. */
  notices?: string[];
  saving: boolean;
  onSave: (items: EditableItem[]) => void;
  onDiscard: () => void;
  onEditOriginal: () => void;
}

/**
 * Review step. Every card is collapsed to a one-line summary by default —
 * the old version opened seven full field editors at once, which on a phone
 * is a wall of inputs for something the AI has usually got right. The user
 * scans summaries, expands only what looks wrong, and saves.
 */
export function ConfirmationPanel({
  items: initialItems,
  droppedCount,
  notices = [],
  saving,
  onSave,
  onDiscard,
  onEditOriginal,
}: ConfirmationPanelProps) {
  const [items, setItems] = useState<EditableItem[]>(initialItems);

  const includedCount = items.filter((entry) => entry.included).length;
  const openQuestions = items.filter(isBlocked).length;
  const incomplete = items.filter(isIncomplete).length;
  const canSave = includedCount > 0 && openQuestions === 0 && incomplete === 0;

  function updateItem(index: number, updated: EditableItem) {
    setItems((current) => current.map((entry, i) => (i === index ? updated : entry)));
  }

  return (
    <>
      <SheetBody>
        {/* Names the content, not the count — the count is visible by looking. */}
        <p className="pb-3 text-base text-muted-foreground" role="status">
          {describeItemsCapitalised(items.map((entry) => entry.item))}. Tap any of them to edit.
          Nothing is saved until you say so.
        </p>

        {/* The trip-brain moment: said here, while rebooking is cheap, and
            never blocking — the user may know something MeOS doesn't. */}
        {notices.map((notice) => (
          <p
            key={notice}
            role="status"
            className="mb-3 rounded-md bg-warning/10 px-3 py-2.5 text-base text-warning"
          >
            {notice}
          </p>
        ))}

        {openQuestions > 0 && (
          <p
            role="status"
            className="mb-3 rounded-md bg-warning/10 px-3 py-2.5 text-base text-warning"
          >
            {openQuestions === 1
              ? "One date could be read more than one way — say which you meant and MeOS will save it."
              : `${openQuestions} dates could be read more than one way — say which you meant and MeOS will save them.`}
          </p>
        )}

        {incomplete > 0 && (
          <p
            role="status"
            className="mb-3 rounded-md bg-warning/10 px-3 py-2.5 text-base text-warning"
          >
            {incomplete === 1
              ? "One card still needs something filled in — the note on it says what, or drop it."
              : `${incomplete} cards still need something filled in — the notes on them say what, or drop them.`}
          </p>
        )}

        {droppedCount > 0 && (
          <p className="mb-3 rounded-md bg-warning/10 px-3 py-2.5 text-base text-warning">
            {droppedCount} more {droppedCount === 1 ? "item was" : "items were"} unclear and{" "}
            {droppedCount === 1 ? "was" : "were"} left out.
          </p>
        )}

        <ul className="flex flex-col gap-2.5">
          {items.map((entry, index) => (
            <li key={entry.item.temporaryId}>
              <ItemCard
                entry={entry}
                allItems={items}
                disabled={saving}
                onChange={(updated) => updateItem(index, updated)}
              />
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={onEditOriginal}
          disabled={saving}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-md px-3 py-2.5 text-base font-medium text-muted-foreground transition-colors active:bg-secondary disabled:opacity-50"
        >
          <PencilLine className="size-4" aria-hidden />
          Rewrite what I said
        </button>
      </SheetBody>

      <SheetFooter className="flex items-center gap-2.5 pb-3">
        <button
          type="button"
          onClick={onDiscard}
          disabled={saving}
          className="h-13 rounded-lg px-5 text-body font-medium text-muted-foreground transition-colors active:bg-secondary disabled:opacity-50"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={() => onSave(items)}
          disabled={saving || !canSave}
          aria-busy={saving}
          className="flex h-13 flex-1 items-center justify-center gap-2 rounded-lg bg-primary text-body font-semibold text-primary-foreground shadow-accent transition-[transform,opacity] duration-150 active:scale-[0.985] disabled:opacity-50 disabled:shadow-none"
        >
          {saving ? (
            <>
              <Loader2 className="size-4.5 animate-spin" aria-hidden />
              Saving…
            </>
          ) : openQuestions > 0 ? (
            openQuestions === 1 ? (
              "Pick a day first"
            ) : (
              `Pick ${openQuestions} days first`
            )
          ) : incomplete > 0 ? (
            incomplete === 1 ? (
              "Finish the card first"
            ) : (
              `Finish ${incomplete} cards first`
            )
          ) : includedCount === 0 ? (
            "Nothing kept"
          ) : (
            `Save ${includedCount}`
          )}
        </button>
      </SheetFooter>
    </>
  );
}
