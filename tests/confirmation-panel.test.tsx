// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ConfirmationPanel, type EditableItem } from "@/components/inbox/confirmation-panel";
import { normaliseProposals } from "@/lib/extraction/normalise";
import { parseExtractionResponse } from "@/lib/extraction/schema";
import { browserTimeZone } from "@/lib/temporal/inputs";
import { isoDateInZone } from "@/lib/temporal/zone";

/**
 * The confirmation sheet's date question, from the user's side.
 *
 * Fixtures go through the real Zod + normalisation path so the question and its
 * options are the ones the app would actually render — a hand-written
 * `dateAmbiguity` would let this pass while the pipeline was broken.
 */

const TZ = "Asia/Jerusalem";
const NOW = new Date("2026-08-10T15:30:00Z"); // Mon 10 Aug, 18:30 local

/*
 * The component re-derives a list's title on interaction against the *wall*
 * clock — correctly, because "Shopping for tomorrow" is relative to the day
 * the user is standing in. Fixtures alone therefore cannot pin these
 * assertions: on 13 August the fixture's 14 August silently became "tomorrow"
 * and this file failed for the first time, three days after it was written.
 *
 * Only Date is faked. Faking timers wholesale would deadlock user-event, which
 * schedules its own.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const RESPONSE = {
  items: [
    {
      temporaryId: "item-1",
      category: "task",
      action: "create",
      confidence: 0.9,
      summary: "Collect the parcel",
      relationships: [],
      missingFields: [],
      sourceText: "Collect the parcel next Friday",
      structuredData: { title: "Collect the parcel", notes: null, datePhrase: "next Friday" },
    },
    {
      temporaryId: "item-2",
      category: "note",
      action: "create",
      confidence: 0.95,
      summary: "The blue door café does the good coffee",
      relationships: [],
      missingFields: [],
      sourceText: "The blue door café does the good coffee",
      structuredData: {
        title: null,
        content: "The blue door café does the good coffee",
        noteType: "place",
      },
    },
  ],
};

/** A shopping list dated with the same unresolvable phrase. */
const LIST_RESPONSE = {
  items: [
    {
      temporaryId: "list-1",
      category: "list",
      action: "create",
      confidence: 0.9,
      summary: "A list",
      relationships: [],
      missingFields: [],
      sourceText: "shopping list for next Friday: milk",
      structuredData: {
        title: "Shopping list",
        listKind: "shopping",
        datePhrase: "next Friday",
        items: [{ text: "Milk", quantity: null, unit: null }],
      },
    },
  ],
};

function editableFrom(raw: unknown, overrides: Partial<EditableItem> = {}): EditableItem[] {
  const { items } = parseExtractionResponse(raw);
  const { items: normalised } = normaliseProposals(items, { now: NOW, timeZone: TZ });
  return normalised.map((item) => ({
    item,
    included: true,
    matchedPersonId: null,
    matchedPersonName: null,
    useExistingPerson: false,
    dateChoice: null,
    ...(item.category === "note" ? {} : overrides),
  }));
}

const editableItems = (overrides: Partial<EditableItem> = {}) => editableFrom(RESPONSE, overrides);

function renderPanel(items: EditableItem[] = editableItems()) {
  const onSave = vi.fn();
  render(
    <ConfirmationPanel
      items={items}
      droppedCount={0}
      saving={false}
      onSave={onSave}
      onDiscard={vi.fn()}
      onEditOriginal={vi.fn()}
    />,
  );
  return { onSave, user: userEvent.setup() };
}

// `globals` is off in vitest.config, so RTL never registers its own afterEach.
afterEach(cleanup);

const saveButton = () => screen.getByRole("button", { name: /save|pick a day|nothing kept/i });

describe("confirmation panel: unresolved dates", () => {
  it("asks the question instead of hiding it in the editor", () => {
    renderPanel();
    const group = screen.getByRole("radiogroup");
    expect(group).toHaveAccessibleName(/next Friday/);
    expect(screen.getByRole("radio", { name: "Fri 14 Aug" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Fri 21 Aug" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "No date" })).toBeInTheDocument();
  });

  it("holds the save until the day is picked, and says why", () => {
    renderPanel();
    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveTextContent("Pick a day first");
    // Queried by text, not by role: the panel's intro line is also a status
    // region, so the role alone doesn't identify this one.
    expect(screen.getByText(/One date could be read more than one way/)).toHaveAttribute(
      "role",
      "status",
    );
  });

  it("saves the reading the user picked", async () => {
    const { onSave, user } = renderPanel();
    await user.click(screen.getByRole("radio", { name: "Fri 21 Aug" }));

    expect(saveButton()).toBeEnabled();
    expect(saveButton()).toHaveTextContent("Save 2");
    await user.click(saveButton());

    const task = onSave.mock.calls[0]![0].find(
      (entry: EditableItem) => entry.item.category === "task",
    )!;
    expect(task.item.structuredData.resolvedDueAt).toBe("2026-08-20T21:00:00.000Z");
    expect(task.item.structuredData.resolvedAllDay).toBe(true);
  });

  it("treats “no date” as an answer, not as an unanswered question", async () => {
    const { onSave, user } = renderPanel();
    await user.click(screen.getByRole("radio", { name: "No date" }));

    // Visibly acknowledged, so "answered: no day" doesn't read as "unanswered".
    expect(screen.getByText(/Understood as/)).toHaveTextContent("no date");
    expect(saveButton()).toBeEnabled();
    await user.click(saveButton());

    const task = onSave.mock.calls[0]![0].find(
      (entry: EditableItem) => entry.item.category === "task",
    )!;
    expect(task.item.structuredData.resolvedDueAt).toBeNull();
  });

  it("lets the answer be changed before saving", async () => {
    const { onSave, user } = renderPanel();
    await user.click(screen.getByRole("radio", { name: "Fri 14 Aug" }));
    await user.click(screen.getByRole("radio", { name: "Fri 21 Aug" }));
    await user.click(saveButton());

    const task = onSave.mock.calls[0]![0].find(
      (entry: EditableItem) => entry.item.category === "task",
    )!;
    expect(task.item.structuredData.resolvedDueAt).toBe("2026-08-20T21:00:00.000Z");
  });

  it("stops blocking once the unclear item is dropped", () => {
    renderPanel(editableItems({ included: false }));
    expect(saveButton()).toBeEnabled();
    expect(saveButton()).toHaveTextContent("Save 1");
    expect(screen.queryByText(/could be read more than one way/)).not.toBeInTheDocument();
  });
});

describe("confirmation panel: the task editor", () => {
  async function expandTask() {
    const { onSave, user } = renderPanel();
    await user.click(screen.getByRole("button", { name: /Collect the parcel/ }));
    return { onSave, user };
  }

  it("edits the title", async () => {
    const { onSave, user } = await expandTask();
    const title = screen.getByRole("textbox", { name: "Task" });
    await user.clear(title);
    await user.type(title, "Collect the parcel from the depot");
    await user.click(screen.getByRole("radio", { name: "Fri 14 Aug" }));
    await user.click(saveButton());

    const task = onSave.mock.calls[0]![0].find(
      (entry: EditableItem) => entry.item.category === "task",
    )!;
    expect(task.item.structuredData.title).toBe("Collect the parcel from the depot");
  });

  it("shows the phrase the date came from", async () => {
    await expandTask();
    expect(screen.getByText(/in what you said/)).toHaveTextContent("next Friday");
  });

  it("counts a date typed into the editor as answering the question", async () => {
    const { onSave, user } = await expandTask();
    // fireEvent rather than user.type: date inputs take a whole value at once.
    fireEvent.change(screen.getByLabelText("Due"), { target: { value: "2026-08-18" } });

    expect(saveButton()).toBeEnabled();
    expect(screen.getByRole("radio", { name: "Fri 14 Aug" })).not.toBeChecked();
    await user.click(saveButton());

    const task = onSave.mock.calls[0]![0].find(
      (entry: EditableItem) => entry.item.category === "task",
    )!;
    // Stored as an instant, but it must still be the 18th where the user is.
    const stored = new Date(task.item.structuredData.resolvedDueAt);
    expect(isoDateInZone(stored, browserTimeZone())).toBe("2026-08-18");
  });

  it("keeps the day when all-day is switched off", async () => {
    const { onSave, user } = await expandTask();
    fireEvent.change(screen.getByLabelText("Due"), { target: { value: "2026-08-18" } });
    await user.click(screen.getByRole("checkbox", { name: /All day/ }));
    await user.click(saveButton());

    const task = onSave.mock.calls[0]![0].find(
      (entry: EditableItem) => entry.item.category === "task",
    )!;
    expect(task.item.structuredData.resolvedAllDay).toBe(false);
    expect(
      isoDateInZone(new Date(task.item.structuredData.resolvedDueAt), browserTimeZone()),
    ).toBe("2026-08-18");
  });
});

describe("confirmation panel: the list editor", () => {
  const renderList = () => renderPanel(editableFrom(LIST_RESPONSE));

  it("keeps the summary in step with the items", async () => {
    const { user } = renderList();
    expect(screen.getByRole("button", { name: /Milk/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Milk/ }));
    await user.click(screen.getByRole("button", { name: "Add item" }));
    await user.type(screen.getAllByRole("textbox", { name: "Item" })[1]!, "Eggs");

    expect(screen.getByRole("button", { name: /Milk, Eggs/ })).toBeInTheDocument();
  });

  it("names the day in the title once the question is answered", async () => {
    const { user } = renderList();
    await user.click(screen.getByRole("button", { name: /Milk/ }));
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Shopping");

    await user.click(screen.getByRole("radio", { name: "Fri 14 Aug" }));
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Shopping for 14 Aug");
  });

  it("never overwrites a title the user wrote themselves", async () => {
    const { user } = renderList();
    await user.click(screen.getByRole("button", { name: /Milk/ }));
    const title = screen.getByRole("textbox", { name: "Title" });
    await user.clear(title);
    await user.type(title, "Weekly big shop");

    await user.click(screen.getByRole("radio", { name: "Fri 21 Aug" }));
    expect(title).toHaveValue("Weekly big shop");
  });

  it("removes an item", async () => {
    const { user } = renderList();
    await user.click(screen.getByRole("button", { name: /Milk/ }));
    await user.click(screen.getByRole("button", { name: "Remove Milk" }));

    expect(screen.getByText(/Nothing on it yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Empty list/ })).toBeInTheDocument();
  });
});
