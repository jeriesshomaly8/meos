"use client";

import { useId, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  Link2,
  Plus,
  Sparkles,
  Trash2,
  UserRoundCheck,
} from "lucide-react";
import { CATEGORY_META } from "@/lib/categories";
import { uncertaintyHint } from "@/lib/extraction/describe";
import { formatEventDate, UNKNOWN_YEAR_SENTINEL } from "@/lib/dates";
import { resolveCalendarPhrase } from "@/lib/temporal/resolve";
import { describeRrule } from "@/lib/temporal/recurrence";
import {
  alarmDateRequirement,
  applyDateChoice,
  customTitleRequirement,
  customTypeNameRequirement,
  dateAmbiguityOf,
  eventDateRequirement,
  importantDateRequirement,
  listRowsRequirement,
  missingRequirementOf,
  reminderDateRequirement,
  resolvedAllDayOf,
  resolvedDueAtOf,
  textRequirement,
  type DateAmbiguity,
  type DateChoice,
} from "@/lib/extraction/ambiguity";
import { CONVERSION_TARGETS, convertCategory, type ConversionTarget } from "@/lib/extraction/convert";
import {
  deriveListSummary,
  deriveListTitle,
  isDerivedListSummary,
  isDerivedListTitle,
  LIST_KIND_LABEL,
  storedResolution,
} from "@/lib/extraction/normalise";
import { normaliseTypeKey } from "@/lib/items/types";
import type {
  AlarmData,
  CustomData,
  DocumentData,
  EventData,
  ExtractedItem,
  FoodPreferenceData,
  ImportantDateData,
  ListData,
  NoteData,
  PersonData,
  RecipeData,
  ReminderData,
  TaskData,
} from "@/lib/extraction/schema";
import {
  browserTimeZone,
  fromDateInput,
  fromDateTimeInput,
  setAllDay,
  toDateInput,
  toDateTimeInput,
} from "@/lib/temporal/inputs";
import { cn } from "@/lib/utils";
import { OsAlarmButton } from "@/components/alarms/os-alarm-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import type { EditableItem } from "./confirmation-panel";

/* ---------------------------------- shared ---------------------------------- */

function Field({
  label,
  children,
  htmlFor,
  requirement = null,
}: {
  label: string;
  children: React.ReactNode;
  htmlFor: string;
  /**
   * The sentence from `missingRequirementOf`'s field-level helper, printed
   * beside the input it names — the same treatment the date fields already
   * get. The input itself must also carry `aria-invalid` and point
   * `aria-describedby` at `${htmlFor}-error`.
   */
  requirement?: string | null;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
      {requirement && (
        <p id={`${htmlFor}-error`} className="text-xs text-warning">
          {requirement}
        </p>
      )}
    </div>
  );
}

/** The three attributes an input with a live requirement carries. */
function invalidProps(requirement: string | null, htmlFor: string) {
  return {
    "aria-invalid": requirement !== null,
    "aria-describedby": requirement ? `${htmlFor}-error` : undefined,
  };
}

/**
 * Only surfaced when the model wasn't sure. A percentage on every card is
 * noise the user can't act on; naming what is shaky on the two it got wrong is
 * information — see `uncertaintyHint`.
 */
const UNSURE_THRESHOLD = 0.8;

/**
 * One quantity · unit · name row. Recipe ingredients and list items are the
 * same shape on screen, so they are the same component — the alternative is
 * two copies of forty lines that drift apart.
 */
function QuantityRow({
  quantity,
  unit,
  text,
  textLabel,
  removeLabel,
  disabled,
  onChange,
  onRemove,
}: {
  quantity: number | null;
  unit: string | null;
  text: string;
  textLabel: string;
  removeLabel: string;
  disabled: boolean;
  onChange: (next: { quantity: number | null; unit: string | null; text: string }) => void;
  onRemove: () => void;
}) {
  const current = { quantity, unit, text };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        className="w-24"
        aria-label="Quantity"
        type="number"
        min={0}
        step="any"
        value={quantity ?? ""}
        disabled={disabled}
        onChange={(e) =>
          onChange({ ...current, quantity: e.target.value ? Number(e.target.value) : null })
        }
      />
      <Input
        className="w-20"
        aria-label="Unit"
        placeholder="unit"
        value={unit ?? ""}
        disabled={disabled}
        onChange={(e) => onChange({ ...current, unit: e.target.value || null })}
      />
      <Input
        className="min-w-32 flex-1"
        aria-label={textLabel}
        value={text}
        disabled={disabled}
        onChange={(e) => onChange({ ...current, text: e.target.value })}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={removeLabel}
        disabled={disabled}
        onClick={onRemove}
      >
        <Trash2 aria-hidden />
      </Button>
    </div>
  );
}

/* ------------------------------ category editors ----------------------------- */

interface EditorProps<T> {
  data: T;
  onChange: (data: T) => void;
  disabled: boolean;
  idPrefix: string;
}

function PersonEditor({ data, onChange, disabled, idPrefix }: EditorProps<PersonData>) {
  const nameRequirement = textRequirement(data.name, "personName");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name" htmlFor={`${idPrefix}-name`} requirement={nameRequirement}>
        <Input
          id={`${idPrefix}-name`}
          value={data.name}
          disabled={disabled}
          {...invalidProps(nameRequirement, `${idPrefix}-name`)}
          onChange={(e) => onChange({ ...data, name: e.target.value })}
        />
      </Field>
      <Field label="Relationship" htmlFor={`${idPrefix}-relationship`}>
        <Input
          id={`${idPrefix}-relationship`}
          value={data.relationship ?? ""}
          placeholder="friend, sister, colleague…"
          disabled={disabled}
          onChange={(e) => onChange({ ...data, relationship: e.target.value || null })}
        />
      </Field>
      <Field label="Birthday" htmlFor={`${idPrefix}-birthday`}>
        <div className="flex flex-col gap-2">
          <Input
            id={`${idPrefix}-birthday`}
            type="date"
            value={data.birthday ?? ""}
            disabled={disabled}
            onChange={(e) => {
              const birthday = e.target.value || null;
              onChange({
                ...data,
                birthday,
                // Typing a real year *is* stating the year. Someone genuinely
                // born in 2000 can tick the box — it sits right below.
                birthdayYearKnown:
                  birthday && !birthday.startsWith(`${UNKNOWN_YEAR_SENTINEL}-`)
                    ? true
                    : data.birthdayYearKnown,
              });
            }}
          />
          {data.birthday && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={data.birthdayYearKnown}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  onChange({ ...data, birthdayYearKnown: checked === true })
                }
              />
              The year is correct (untick if you only know month and day)
            </label>
          )}
          {data.birthdayPhrase && (
            <p className="text-xs text-muted-foreground">
              From &ldquo;<span className="italic">{data.birthdayPhrase}</span>&rdquo; in what you
              said.
            </p>
          )}
        </div>
      </Field>
      <Field label="Notes" htmlFor={`${idPrefix}-notes`}>
        <Input
          id={`${idPrefix}-notes`}
          value={data.notes ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ ...data, notes: e.target.value || null })}
        />
      </Field>
      <div className="sm:col-span-2">
        <p className="mb-1.5 text-xs text-muted-foreground">Preferences (non-food)</p>
        <div className="flex flex-col gap-2">
          {data.generalPreferences.map((pref, index) => (
            <div key={index} className="flex items-center gap-2">
              <Select
                value={pref.preferenceType}
                disabled={disabled}
                onValueChange={(value) =>
                  onChange({
                    ...data,
                    generalPreferences: data.generalPreferences.map((p, i) =>
                      i === index ? { ...p, preferenceType: value as "like" | "dislike" } : p,
                    ),
                  })
                }
              >
                <SelectTrigger className="w-28" aria-label="Preference type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="like">Likes</SelectItem>
                  <SelectItem value="dislike">Dislikes</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={pref.value}
                aria-label="Preference"
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    ...data,
                    generalPreferences: data.generalPreferences.map((p, i) =>
                      i === index ? { ...p, value: e.target.value } : p,
                    ),
                  })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove preference"
                disabled={disabled}
                onClick={() =>
                  onChange({
                    ...data,
                    generalPreferences: data.generalPreferences.filter((_, i) => i !== index),
                  })
                }
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            disabled={disabled}
            onClick={() =>
              onChange({
                ...data,
                generalPreferences: [
                  ...data.generalPreferences,
                  { preferenceType: "like", value: "" },
                ],
              })
            }
          >
            <Plus aria-hidden /> Add preference
          </Button>
        </div>
      </div>
    </div>
  );
}

function ImportantDateEditor({
  data,
  onChange,
  disabled,
  idPrefix,
}: EditorProps<ImportantDateData>) {
  // `event_date` is `not null` in the database; the message mirrors the card
  // banner from one shared sentence, like an alarm's time does.
  const requirement = importantDateRequirement(data);
  const errorId = `${idPrefix}-date-error`;
  const titleRequirement = textRequirement(data.title, "importantDateTitle");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Title" htmlFor={`${idPrefix}-title`} requirement={titleRequirement}>
        <Input
          id={`${idPrefix}-title`}
          value={data.title}
          disabled={disabled}
          {...invalidProps(titleRequirement, `${idPrefix}-title`)}
          onChange={(e) => onChange({ ...data, title: e.target.value })}
        />
      </Field>
      <Field label="Date" htmlFor={`${idPrefix}-date`}>
        <div className="flex flex-col gap-2">
          <Input
            id={`${idPrefix}-date`}
            type="date"
            value={data.eventDate ?? ""}
            disabled={disabled}
            aria-invalid={requirement !== null}
            aria-describedby={requirement ? errorId : undefined}
            onChange={(e) => {
              const eventDate = e.target.value || null;
              onChange({
                ...data,
                eventDate,
                // Same rule as a birthday: a typed non-sentinel year is real.
                yearKnown:
                  eventDate && !eventDate.startsWith(`${UNKNOWN_YEAR_SENTINEL}-`)
                    ? true
                    : data.yearKnown,
              });
            }}
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={data.yearKnown}
              disabled={disabled}
              onCheckedChange={(checked) => onChange({ ...data, yearKnown: checked === true })}
            />
            The year is correct
          </label>
          {requirement && (
            <p id={errorId} className="text-xs text-warning">
              {requirement}
            </p>
          )}
          {data.datePhrase && (
            <p className="text-xs text-muted-foreground">
              From &ldquo;<span className="italic">{data.datePhrase}</span>&rdquo; in what you
              said.
            </p>
          )}
        </div>
      </Field>
      <Field label="Repeats" htmlFor={`${idPrefix}-recurrence`}>
        <Select
          value={data.recurrence}
          disabled={disabled}
          onValueChange={(value) => {
            const recurrence = value as "none" | "yearly";
            /*
             * A sentinel-year date only means something while it recurs; as a
             * one-off, "June 12, year 2000" would be an event 26 years ago.
             * Flipping to one-off re-reads the phrase as an upcoming date, or
             * clears it and lets the requirement gate ask.
             */
            if (recurrence === "none" && !data.yearKnown) {
              const resolution = data.datePhrase
                ? resolveCalendarPhrase(
                    data.datePhrase,
                    { now: new Date(), timeZone: browserTimeZone() },
                    "future",
                  )
                : null;
              onChange({
                ...data,
                recurrence,
                eventDate: resolution?.kind === "resolved" ? resolution.isoDate : null,
                yearKnown: resolution?.kind === "resolved" ? resolution.yearKnown : true,
              });
              return;
            }
            onChange({ ...data, recurrence });
          }}
        >
          <SelectTrigger id={`${idPrefix}-recurrence`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="yearly">Every year</SelectItem>
            <SelectItem value="none">One-off</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Notes" htmlFor={`${idPrefix}-notes`}>
        <Input
          id={`${idPrefix}-notes`}
          value={data.notes ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ ...data, notes: e.target.value || null })}
        />
      </Field>
      {data.eventDate && (
        <p className="text-xs text-muted-foreground sm:col-span-2">
          Understood as:{" "}
          <strong className="font-medium text-foreground">
            {formatEventDate(data.eventDate, data.yearKnown)}
            {data.recurrence === "yearly" && ", every year"}
          </strong>
        </p>
      )}
    </div>
  );
}

/**
 * A reminder is now a phrase the app resolved, like a task — so it gets the
 * same field, the same ambiguity question and the same all-day switch, rather
 * than a bare `datetime-local` holding whatever instant the model calculated.
 */
function ReminderEditor({ data, onChange, disabled, idPrefix }: EditorProps<ReminderData>) {
  const titleRequirement = textRequirement(data.title, "reminderTitle");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Reminder" htmlFor={`${idPrefix}-title`} requirement={titleRequirement}>
        <Input
          id={`${idPrefix}-title`}
          value={data.title}
          disabled={disabled}
          {...invalidProps(titleRequirement, `${idPrefix}-title`)}
          onChange={(e) => onChange({ ...data, title: e.target.value })}
        />
      </Field>
      <DueDateField
        label="When"
        data={data}
        requirement={reminderDateRequirement(data)}
        disabled={disabled}
        idPrefix={idPrefix}
        onChange={(next) => onChange({ ...data, ...next })}
      />
    </div>
  );
}

function FoodPreferenceEditor({
  data,
  onChange,
  disabled,
  idPrefix,
}: EditorProps<FoodPreferenceData>) {
  const foodRequirement = textRequirement(data.foodName, "foodName");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Who" htmlFor={`${idPrefix}-subject`}>
        <Input
          id={`${idPrefix}-subject`}
          value={data.subjectName ?? ""}
          placeholder="Leave empty if it's about you"
          disabled={disabled || data.subjectRef !== null}
          onChange={(e) => onChange({ ...data, subjectName: e.target.value || null })}
        />
      </Field>
      <Field label="Food / restriction" htmlFor={`${idPrefix}-food`} requirement={foodRequirement}>
        <Input
          id={`${idPrefix}-food`}
          value={data.foodName}
          disabled={disabled}
          {...invalidProps(foodRequirement, `${idPrefix}-food`)}
          onChange={(e) => onChange({ ...data, foodName: e.target.value })}
        />
      </Field>
      <Field label="Type" htmlFor={`${idPrefix}-type`}>
        <Select
          value={data.preferenceType}
          disabled={disabled}
          onValueChange={(value) =>
            onChange({ ...data, preferenceType: value as FoodPreferenceData["preferenceType"] })
          }
        >
          <SelectTrigger id={`${idPrefix}-type`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="like">Likes</SelectItem>
            <SelectItem value="dislike">Dislikes</SelectItem>
            <SelectItem value="allergy">Allergy</SelectItem>
            <SelectItem value="dietary_restriction">Dietary restriction</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {data.preferenceType === "allergy" && (
        <Field label="Severity" htmlFor={`${idPrefix}-severity`}>
          <Select
            value={data.severity ?? "unspecified"}
            disabled={disabled}
            onValueChange={(value) =>
              onChange({
                ...data,
                severity:
                  value === "unspecified" ? null : (value as FoodPreferenceData["severity"]),
              })
            }
          >
            <SelectTrigger id={`${idPrefix}-severity`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unspecified">Not specified</SelectItem>
              <SelectItem value="mild">Mild</SelectItem>
              <SelectItem value="moderate">Moderate</SelectItem>
              <SelectItem value="severe">Severe</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}
    </div>
  );
}

function RecipeEditor({ data, onChange, disabled, idPrefix }: EditorProps<RecipeData>) {
  const nameRequirement = textRequirement(data.name, "recipeName");
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Recipe name" htmlFor={`${idPrefix}-name`} requirement={nameRequirement}>
          <Input
            id={`${idPrefix}-name`}
            value={data.name}
            disabled={disabled}
            {...invalidProps(nameRequirement, `${idPrefix}-name`)}
            onChange={(e) => onChange({ ...data, name: e.target.value })}
          />
        </Field>
        <Field label="Servings" htmlFor={`${idPrefix}-servings`}>
          <Input
            id={`${idPrefix}-servings`}
            type="number"
            min={1}
            value={data.servings ?? ""}
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...data, servings: e.target.value ? Number(e.target.value) : null })
            }
          />
        </Field>
        <Field label="Prep time (minutes)" htmlFor={`${idPrefix}-prep`}>
          <Input
            id={`${idPrefix}-prep`}
            type="number"
            min={0}
            value={data.preparationTimeMinutes ?? ""}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                ...data,
                preparationTimeMinutes: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </Field>
        <Field label="Cooking time (minutes)" htmlFor={`${idPrefix}-cook`}>
          <Input
            id={`${idPrefix}-cook`}
            type="number"
            min={0}
            value={data.cookingTimeMinutes ?? ""}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                ...data,
                cookingTimeMinutes: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </Field>
      </div>
      <div>
        <p className="mb-1.5 text-xs text-muted-foreground">Ingredients</p>
        <div className="flex flex-col gap-2">
          {data.ingredients.map((ingredient, index) => (
            <QuantityRow
              key={index}
              quantity={ingredient.quantity}
              unit={ingredient.unit}
              text={ingredient.ingredientName}
              textLabel="Ingredient"
              removeLabel={`Remove ${ingredient.ingredientName || "ingredient"}`}
              disabled={disabled}
              onChange={(next) =>
                onChange({
                  ...data,
                  ingredients: data.ingredients.map((ing, i) =>
                    i === index
                      ? {
                          ...ing,
                          quantity: next.quantity,
                          unit: next.unit,
                          ingredientName: next.text,
                        }
                      : ing,
                  ),
                })
              }
              onRemove={() =>
                onChange({ ...data, ingredients: data.ingredients.filter((_, i) => i !== index) })
              }
            />
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            disabled={disabled}
            onClick={() =>
              onChange({
                ...data,
                ingredients: [
                  ...data.ingredients,
                  { ingredientName: "", quantity: null, unit: null, optional: false, notes: null },
                ],
              })
            }
          >
            <Plus aria-hidden /> Add ingredient
          </Button>
        </div>
      </div>
      <Field label="Instructions" htmlFor={`${idPrefix}-instructions`}>
        <Textarea
          id={`${idPrefix}-instructions`}
          rows={4}
          value={data.instructions ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ ...data, instructions: e.target.value || null })}
        />
      </Field>
    </div>
  );
}

function DocumentEditor({ data, onChange, disabled, idPrefix }: EditorProps<DocumentData>) {
  const nameRequirement = textRequirement(data.displayName, "documentName");
  const typeRequirement = textRequirement(data.documentType, "documentType");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Document" htmlFor={`${idPrefix}-display-name`} requirement={nameRequirement}>
        <Input
          id={`${idPrefix}-display-name`}
          value={data.displayName}
          disabled={disabled}
          {...invalidProps(nameRequirement, `${idPrefix}-display-name`)}
          onChange={(e) => onChange({ ...data, displayName: e.target.value })}
        />
      </Field>
      <Field label="Type" htmlFor={`${idPrefix}-doc-type`} requirement={typeRequirement}>
        <Input
          id={`${idPrefix}-doc-type`}
          value={data.documentType}
          placeholder="passport, insurance…"
          disabled={disabled}
          {...invalidProps(typeRequirement, `${idPrefix}-doc-type`)}
          onChange={(e) => onChange({ ...data, documentType: e.target.value })}
        />
      </Field>
      <Field label="Expiration date" htmlFor={`${idPrefix}-expiration`}>
        <div className="flex flex-col gap-2">
          <Input
            id={`${idPrefix}-expiration`}
            type="date"
            value={data.expirationDate ?? ""}
            disabled={disabled}
            onChange={(e) => onChange({ ...data, expirationDate: e.target.value || null })}
          />
          {data.expiryPhrase && (
            <p className="text-xs text-muted-foreground">
              From &ldquo;<span className="italic">{data.expiryPhrase}</span>&rdquo; in what you
              said.
            </p>
          )}
        </div>
      </Field>
      <Field label="Issue date" htmlFor={`${idPrefix}-issue`}>
        <div className="flex flex-col gap-2">
          <Input
            id={`${idPrefix}-issue`}
            type="date"
            value={data.issueDate ?? ""}
            disabled={disabled}
            onChange={(e) => onChange({ ...data, issueDate: e.target.value || null })}
          />
          {data.issuePhrase && (
            <p className="text-xs text-muted-foreground">
              From &ldquo;<span className="italic">{data.issuePhrase}</span>&rdquo; in what you
              said.
            </p>
          )}
        </div>
      </Field>
      <Field label="Document number (kept masked)" htmlFor={`${idPrefix}-number`}>
        <Input
          id={`${idPrefix}-number`}
          value={data.documentNumber ?? ""}
          autoComplete="off"
          disabled={disabled}
          onChange={(e) => onChange({ ...data, documentNumber: e.target.value || null })}
        />
      </Field>
      <Field label="Issuing country" htmlFor={`${idPrefix}-country`}>
        <Input
          id={`${idPrefix}-country`}
          value={data.issuingCountry ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ ...data, issuingCountry: e.target.value || null })}
        />
      </Field>
      {data.expirationDate && (
        <p className="text-xs text-muted-foreground sm:col-span-2">
          Expires:{" "}
          <strong className="font-medium text-foreground">
            {formatEventDate(data.expirationDate, true)}
          </strong>
        </p>
      )}
    </div>
  );
}

function NoteEditor({ data, onChange, disabled, idPrefix }: EditorProps<NoteData>) {
  const contentRequirement = textRequirement(data.content, "noteContent");
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" htmlFor={`${idPrefix}-title`}>
          <Input
            id={`${idPrefix}-title`}
            value={data.title ?? ""}
            placeholder="Optional"
            disabled={disabled}
            onChange={(e) => onChange({ ...data, title: e.target.value || null })}
          />
        </Field>
        <Field label="Kind" htmlFor={`${idPrefix}-note-type`}>
          <Select
            value={data.noteType}
            disabled={disabled}
            onValueChange={(value) => onChange({ ...data, noteType: value as NoteData["noteType"] })}
          >
            <SelectTrigger id={`${idPrefix}-note-type`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="general">General</SelectItem>
              <SelectItem value="idea">Idea</SelectItem>
              <SelectItem value="memory">Memory</SelectItem>
              <SelectItem value="place">Place</SelectItem>
              <SelectItem value="gift_idea">Gift idea</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="Note" htmlFor={`${idPrefix}-content`} requirement={contentRequirement}>
        <Textarea
          id={`${idPrefix}-content`}
          rows={3}
          value={data.content}
          disabled={disabled}
          {...invalidProps(contentRequirement, `${idPrefix}-content`)}
          onChange={(e) => onChange({ ...data, content: e.target.value })}
        />
      </Field>
    </div>
  );
}

/**
 * The one place a due date is typed, shared by tasks and lists.
 *
 * Every read and write goes through `src/lib/temporal/inputs` rather than
 * `new Date(value)`: an `<input type="date">` hands back "2026-08-14", which
 * the Date constructor reads as *UTC* midnight and quietly moves the day for
 * anyone west of Greenwich.
 */
function DueDateField({
  data,
  onChange,
  disabled,
  idPrefix,
  label,
  /**
   * False for alarms: "all day" is a contradiction for something that rings at
   * a moment, so the checkbox is hidden and the input is always a date *and*
   * time. `resolvedAllDay` still arrives true from normalisation, meaning "the
   * day is known, the time is not" — typing a time is what answers it.
   */
  allowAllDay = true,
  requirement = null,
}: {
  data: TaskData | ListData | AlarmData;
  onChange: (next: { resolvedDueAt: string | null; resolvedAllDay: boolean }) => void;
  disabled: boolean;
  idPrefix: string;
  label: string;
  allowAllDay?: boolean;
  /** Shown next to the field when the value is required and still missing. */
  requirement?: string | null;
}) {
  const timeZone = browserTimeZone();
  const allDay = allowAllDay && data.resolvedAllDay;
  const errorId = `${idPrefix}-due-error`;

  return (
    <Field label={label} htmlFor={`${idPrefix}-due`}>
      <div className="flex flex-col gap-2">
        <Input
          id={`${idPrefix}-due`}
          type={allDay ? "date" : "datetime-local"}
          value={
            allDay
              ? toDateInput(data.resolvedDueAt, timeZone)
              : toDateTimeInput(data.resolvedDueAt, timeZone)
          }
          disabled={disabled}
          aria-invalid={requirement !== null}
          aria-describedby={requirement ? errorId : undefined}
          onChange={(e) =>
            onChange({
              resolvedAllDay: allDay,
              resolvedDueAt: allDay
                ? fromDateInput(e.target.value, timeZone)
                : fromDateTimeInput(e.target.value, timeZone),
            })
          }
        />
        {allowAllDay && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={allDay}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onChange({
                  resolvedAllDay: checked === true,
                  // Keeps the day and only changes the clock, so ticking the box
                  // can never move a task to a different date.
                  resolvedDueAt: setAllDay(data.resolvedDueAt, checked === true, timeZone),
                })
              }
            />
            All day — no particular time
          </label>
        )}
        {requirement && (
          <p id={errorId} className="text-xs text-warning">
            {requirement}
          </p>
        )}
        {data.rrule && describeRrule(data.rrule, timeZone) && (
          <p className="text-xs text-muted-foreground">
            Repeats{" "}
            <span className="font-medium text-foreground">
              {describeRrule(data.rrule, timeZone)}
            </span>
            . Ticking it off moves it to the next one
            {data.rrule.includes("UNTIL") ? ", and it finishes by itself" : ""}.
          </p>
        )}
        {data.datePhrase && (
          <p className="text-xs text-muted-foreground">
            From &ldquo;<span className="italic">{data.datePhrase}</span>&rdquo; in what you said.
          </p>
        )}
      </div>
    </Field>
  );
}

/**
 * An alarm is a title and a moment — nothing else, because nothing else
 * changes what it does.
 */
function AlarmEditor({ data, onChange, disabled, idPrefix }: EditorProps<AlarmData>) {
  const timeless = data.resolvedDueAt === null || data.resolvedAllDay;
  const titleRequirement = textRequirement(data.title, "alarmTitle");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Alarm" htmlFor={`${idPrefix}-title`} requirement={titleRequirement}>
        <Input
          id={`${idPrefix}-title`}
          value={data.title}
          disabled={disabled}
          {...invalidProps(titleRequirement, `${idPrefix}-title`)}
          onChange={(e) => onChange({ ...data, title: e.target.value })}
        />
      </Field>
      <DueDateField
        label="Rings at"
        data={data}
        allowAllDay={false}
        requirement={alarmDateRequirement(data)}
        disabled={disabled}
        idPrefix={idPrefix}
        // Typing into a datetime-local input is what settles the time, so any
        // edit here also settles the all-day question.
        onChange={(next) => onChange({ ...data, ...next, resolvedAllDay: false })}
      />
      {/*
        The hand-off is independent of saving — it writes to the phone's clock,
        not to MeOS — so it is offered here, at the moment the user is looking
        at the time. Hidden until there is a time to hand off.
      */}
      <OsAlarmButton
        className="sm:col-span-2"
        dueAt={timeless ? null : data.resolvedDueAt}
        title={data.title}
        timeZone={browserTimeZone()}
      />
    </div>
  );
}

/**
 * The card for a type that does not exist yet.
 *
 * It has to say two things at once — what is being *saved* and what is being
 * *created* — because approving it has a consequence beyond this one item: the
 * type joins the registry and everything filed under it later follows. Saying
 * only "Monstera" would hide the half that matters.
 *
 * Renaming the type is the one edit offered here; correcting the item to an
 * existing category is the card-level "Kept as" switch, like any other item.
 */
function CustomEditor({ data, onChange, disabled, idPrefix }: EditorProps<CustomData>) {
  const attributes = Object.entries(data.resolvedAttributes);
  const reused = data.reusedTypeKey !== null;
  const titleRequirement = customTitleRequirement(data);
  const typeNameRequirement = customTypeNameRequirement(data);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <p
          className={cn(
            "flex items-start gap-2 rounded-md px-3 py-2.5 text-sm",
            reused ? "bg-secondary text-muted-foreground" : "bg-accent text-accent-foreground",
          )}
        >
          <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {reused ? (
              <>
                Filing this under <strong className="font-medium">{data.plural}</strong>, which you
                already have.
              </>
            ) : (
              <>
                This doesn&apos;t fit any type you have, so MeOS wants to add{" "}
                <strong className="font-medium">{data.plural}</strong>. Saving creates the type;
                anything like it later files itself the same way.
              </>
            )}
          </span>
        </p>
      </div>

      <Field label={data.singular} htmlFor={`${idPrefix}-title`} requirement={titleRequirement}>
        <Input
          id={`${idPrefix}-title`}
          value={data.title}
          disabled={disabled}
          {...invalidProps(titleRequirement, `${idPrefix}-title`)}
          onChange={(e) => onChange({ ...data, title: e.target.value })}
        />
      </Field>

      {/* Renaming a type MeOS already has would rename it everywhere, so the
          name is only editable while the type is genuinely new. */}
      <Field label="Type name" htmlFor={`${idPrefix}-type`} requirement={typeNameRequirement}>
        <Input
          id={`${idPrefix}-type`}
          value={data.plural}
          disabled={disabled || reused}
          {...invalidProps(typeNameRequirement, `${idPrefix}-type`)}
          onChange={(e) =>
            onChange({
              ...data,
              plural: e.target.value,
              // The key follows the name while the type is new; once saved it
              // is what every future item points at and must stop moving.
              typeKey: normaliseTypeKey(e.target.value) || data.typeKey,
            })
          }
        />
      </Field>

      <DueDateField
        label="When"
        data={data}
        disabled={disabled}
        idPrefix={idPrefix}
        onChange={(next) => onChange({ ...data, ...next })}
      />

      {attributes.length > 0 && (
        <div className="sm:col-span-2">
          <p className="mb-2 px-0.5 text-2xs font-semibold uppercase tracking-[0.09em] text-muted-foreground">
            What you said about it
          </p>
          <dl className="grid gap-1.5">
            {attributes.map(([key, value]) => (
              <div key={key} className="flex gap-2 text-sm">
                <dt className="min-w-32 shrink-0 text-muted-foreground">
                  {key.replace(/_/g, " ")}
                </dt>
                <dd className="min-w-0 flex-1">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

/**
 * An event is a when, a where and a what. Unlike an alarm the date field
 * allows all-day — "conference on Friday" is a real event — but unlike a task
 * it cannot be saved dateless: an event with no when is a note.
 */
function EventEditor({ data, onChange, disabled, idPrefix }: EditorProps<EventData>) {
  const titleRequirement = textRequirement(data.title, "eventTitle");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Event" htmlFor={`${idPrefix}-title`} requirement={titleRequirement}>
        <Input
          id={`${idPrefix}-title`}
          value={data.title}
          disabled={disabled}
          {...invalidProps(titleRequirement, `${idPrefix}-title`)}
          onChange={(e) => onChange({ ...data, title: e.target.value })}
        />
      </Field>
      <DueDateField
        label="When"
        data={data}
        requirement={eventDateRequirement(data)}
        disabled={disabled}
        idPrefix={idPrefix}
        onChange={(next) => onChange({ ...data, ...next })}
      />
      <Field label="Where" htmlFor={`${idPrefix}-location`}>
        <Input
          id={`${idPrefix}-location`}
          value={data.location ?? ""}
          placeholder="Optional"
          disabled={disabled}
          onChange={(e) => onChange({ ...data, location: e.target.value || null })}
        />
      </Field>
      <Field label="Notes" htmlFor={`${idPrefix}-notes`}>
        <Input
          id={`${idPrefix}-notes`}
          value={data.notes ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ ...data, notes: e.target.value || null })}
        />
      </Field>
    </div>
  );
}

function TaskEditor({ data, onChange, disabled, idPrefix }: EditorProps<TaskData>) {
  const titleRequirement = textRequirement(data.title, "taskTitle");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Task" htmlFor={`${idPrefix}-title`} requirement={titleRequirement}>
        <Input
          id={`${idPrefix}-title`}
          value={data.title}
          disabled={disabled}
          {...invalidProps(titleRequirement, `${idPrefix}-title`)}
          onChange={(e) => onChange({ ...data, title: e.target.value })}
        />
      </Field>
      <DueDateField
        label="Due"
        data={data}
        disabled={disabled}
        idPrefix={idPrefix}
        onChange={(next) => onChange({ ...data, ...next })}
      />
      <div className="sm:col-span-2">
        <Field label="Notes" htmlFor={`${idPrefix}-notes`}>
          <Textarea
            id={`${idPrefix}-notes`}
            rows={2}
            value={data.notes ?? ""}
            disabled={disabled}
            onChange={(e) => onChange({ ...data, notes: e.target.value || null })}
          />
        </Field>
      </div>
    </div>
  );
}

function ListEditor({ data, onChange, disabled, idPrefix }: EditorProps<ListData>) {
  const titleRequirement = textRequirement(data.title, "listTitle");
  const rowsRequirement = listRowsRequirement(data);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" htmlFor={`${idPrefix}-title`} requirement={titleRequirement}>
          <Input
            id={`${idPrefix}-title`}
            value={data.title}
            disabled={disabled}
            {...invalidProps(titleRequirement, `${idPrefix}-title`)}
            onChange={(e) => onChange({ ...data, title: e.target.value })}
          />
        </Field>
        <Field label="Kind" htmlFor={`${idPrefix}-kind`}>
          <Select
            value={data.listKind}
            disabled={disabled}
            onValueChange={(value) =>
              onChange({ ...data, listKind: value as ListData["listKind"] })
            }
          >
            <SelectTrigger id={`${idPrefix}-kind`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(LIST_KIND_LABEL).map(([kind, kindLabel]) => (
                <SelectItem key={kind} value={kind}>
                  {kindLabel}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <DueDateField
          label="For when"
          data={data}
          disabled={disabled}
          idPrefix={idPrefix}
          onChange={(next) => onChange({ ...data, ...next })}
        />
      </div>

      <div>
        <p className="mb-1.5 text-xs text-muted-foreground">Items</p>
        <div className="flex flex-col gap-2">
          {data.items.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing on it yet — add the first thing below.
            </p>
          )}
          {data.items.map((entry, index) => (
            <QuantityRow
              key={index}
              quantity={entry.quantity}
              unit={entry.unit}
              text={entry.text}
              textLabel="Item"
              removeLabel={`Remove ${entry.text || "item"}`}
              disabled={disabled}
              onChange={(next) =>
                onChange({
                  ...data,
                  items: data.items.map((row, i) => (i === index ? next : row)),
                })
              }
              onRemove={() =>
                onChange({ ...data, items: data.items.filter((_, i) => i !== index) })
              }
            />
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            disabled={disabled}
            onClick={() =>
              onChange({ ...data, items: [...data.items, { text: "", quantity: null, unit: null }] })
            }
          >
            <Plus aria-hidden /> Add item
          </Button>
          {rowsRequirement && data.items.length > 0 && (
            <p className="text-xs text-warning">{rowsRequirement}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ date ambiguity ------------------------------- */

/** Radio value for "no day at all" — the one choice with no instant behind it. */
const UNDATED_VALUE = "undated";

/**
 * The question the temporal resolver refused to answer for itself.
 *
 * Lives outside the collapsed editor because it blocks saving: a decision the
 * user has to make is not something to hide behind a chevron. Native radios in
 * a labelled group, so arrow keys work and the question is read out with the
 * options rather than as loose text above them.
 */
function AmbiguityPrompt({
  ambiguity,
  choice,
  resolvedDueAt,
  allDay,
  disabled,
  idPrefix,
  onChoose,
}: {
  ambiguity: DateAmbiguity;
  choice: DateChoice | null;
  /** What the item would save with. The editor below can set this too. */
  resolvedDueAt: string | null;
  allDay: boolean;
  disabled: boolean;
  idPrefix: string;
  onChoose: (choice: DateChoice) => void;
}) {
  const questionId = `${idPrefix}-date-question`;
  const matchedOption = ambiguity.options.find((option) => option.iso === resolvedDueAt);

  /*
   * Selection follows the stored date rather than the radio that was clicked,
   * so a date typed into the editor below shows up here instead of leaving the
   * group silently disagreeing with what will be saved.
   */
  const choices: { value: string; label: string; choice: DateChoice; selected: boolean }[] = [
    ...ambiguity.options.map((option) => ({
      value: option.iso,
      label: option.label,
      choice: { kind: "option", iso: option.iso, allDay: option.allDay } as DateChoice,
      selected: option.iso === resolvedDueAt,
    })),
    // "No date" is one of the readings, not an escape from the question, so the
    // whole decision stays one radio group and answering it is one tap.
    {
      value: UNDATED_VALUE,
      label: "No date",
      choice: { kind: "undated" },
      selected: choice?.kind === "undated" && resolvedDueAt === null,
    },
  ];

  const understoodAs = resolvedDueAt
    ? (matchedOption?.label ??
      format(parseISO(resolvedDueAt), allDay ? "EEE d MMM" : "EEE d MMM, HH:mm"))
    : choice?.kind === "undated"
      ? "no date"
      : undefined;

  /** Answered means the card can say what will be saved — the tone follows. */
  const answered = understoodAs !== undefined;

  return (
    <div
      role="radiogroup"
      aria-labelledby={questionId}
      className={cn(
        "mx-3.5 mb-3 rounded-md px-3 py-2.5 transition-colors duration-200",
        answered ? "bg-secondary" : "bg-warning/10",
      )}
    >
      <p
        id={questionId}
        className={cn(
          "flex items-start gap-2 text-sm",
          answered ? "text-muted-foreground" : "text-warning",
        )}
      >
        <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{ambiguity.question}</span>
      </p>

      <div className="mt-2.5 flex flex-wrap gap-2">
        {choices.map((option) => (
          <label key={option.value} className="cursor-pointer">
            <input
              type="radio"
              name={`${idPrefix}-date-choice`}
              value={option.value}
              checked={option.selected}
              disabled={disabled}
              onChange={() => onChoose(option.choice)}
              className="peer sr-only"
            />
            <span
              className={cn(
                // min-h-11 is the 44px touch floor; these are the primary
                // thing to tap on this card.
                "flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors",
                "peer-focus-visible:border-ring peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
                "peer-disabled:opacity-50",
                option.selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-card text-foreground",
              )}
            >
              {option.label}
            </span>
          </label>
        ))}
      </div>

      {understoodAs && (
        <p className="mt-2 text-xs text-muted-foreground">
          Understood as: <strong className="font-medium text-foreground">{understoodAs}</strong>
        </p>
      )}
    </div>
  );
}

/* --------------------------------- the card ---------------------------------- */

interface ItemCardProps {
  entry: EditableItem;
  allItems: EditableItem[];
  disabled: boolean;
  onChange: (entry: EditableItem) => void;
}

export function ItemCard({ entry, allItems, disabled, onChange }: ItemCardProps) {
  const idPrefix = useId();
  const [expanded, setExpanded] = useState(false);
  const { item } = entry;
  const meta = CATEGORY_META[item.category];
  const Icon = meta.icon;
  const unsure = item.confidence < UNSURE_THRESHOLD;

  const relatedSummaries = item.relationships
    .map((tempId) => allItems.find((other) => other.item.temporaryId === tempId))
    .filter((other): other is EditableItem => Boolean(other))
    .map((other) => other.item.summary);

  function updateData(structuredData: ExtractedItem["structuredData"]) {
    // The casts here are safe: each editor only receives and returns its own
    // category's data shape.
    if (item.category === "list") {
      const previous = item.structuredData;
      const data = structuredData as ListData;
      const ctx = { now: new Date(), timeZone: browserTimeZone() };

      /*
       * Derived copy has to follow the data it was derived from — a list still
       * titled "Shopping" after a date is set, or summarised "Milk, Bread" after
       * eggs are added, is a card that lies. But only MeOS's own wording is
       * rewritten: once the user types their own title it survives every later
       * edit, and a title they are mid-way through typing is never overwritten.
       */
      const retitle =
        data.title === previous.title && isDerivedListTitle(previous, ctx)
          ? deriveListTitle(data, storedResolution(data), ctx)
          : data.title;
      const next = { ...data, title: retitle };

      onChange({
        ...entry,
        item: {
          ...item,
          structuredData: next,
          summary: isDerivedListSummary(item.summary, previous)
            ? deriveListSummary(next)
            : item.summary,
        },
      });
      return;
    }

    onChange({ ...entry, item: { ...item, structuredData } as ExtractedItem });
  }

  const ambiguity = dateAmbiguityOf(item);

  function chooseDate(choice: DateChoice) {
    onChange({
      ...entry,
      dateChoice: choice,
      item: applyDateChoice(item, choice, { now: new Date(), timeZone: browserTimeZone() }),
    });
  }

  /**
   * The type-correction half of the plan-style sheet (§Phase 4). Deliberately
   * NOT routed through `updateData` — its casts are safe only while an editor
   * returns its own category's shape, and this is the one edit that changes it.
   */
  function changeCategory(to: ConversionTarget) {
    if (to === item.category) return;
    onChange({
      ...entry,
      item: convertCategory(item, to, { now: new Date(), timeZone: browserTimeZone() }),
      // A person match belongs to the person reading of this item. Left on, the
      // stale id would still be sent and a food preference would quietly link
      // the wrong person as its subject.
      useExistingPerson: false,
      dateChoice: null,
    });
  }

  const showAllergyWarning =
    item.category === "food_preference" && item.structuredData.preferenceType === "allergy";

  // Only surfaced while the item is being kept — telling someone to fix a card
  // they have already switched off is noise.
  const requirement = entry.included ? missingRequirementOf(item) : null;

  return (
    <article
      className={cn(
        "overflow-hidden rounded-lg bg-card shadow-card transition-opacity duration-200",
        !entry.included && "opacity-50",
      )}
      aria-label={`${meta.label}: ${item.summary}`}
    >
      {/* Toggle and keep-switch are siblings, never nested — one hit area
          each, both reachable by keyboard. */}
      <div className="flex items-center gap-1 pe-3">
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          aria-controls={`${idPrefix}-editor`}
          className="flex min-w-0 flex-1 items-center gap-3 px-3.5 py-3 text-start transition-colors active:bg-secondary/60"
        >
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-md",
              meta.softBgClass,
              meta.textClass,
            )}
          >
            <Icon className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{item.summary}</span>
            <span className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              {meta.label}
              {unsure && (
                <>
                  <span className="size-1 rounded-full bg-warning" aria-hidden />
                  <span className="text-warning">{uncertaintyHint(item)}</span>
                </>
              )}
            </span>
          </span>
          <ChevronDown
            className={cn(
              "size-4.5 shrink-0 text-muted-foreground/60 transition-transform duration-200",
              expanded && "rotate-180",
            )}
            aria-hidden
          />
        </button>
        <Switch
          checked={entry.included}
          disabled={disabled}
          onCheckedChange={(checked) => onChange({ ...entry, included: checked === true })}
          aria-label={`Keep this ${meta.label.toLowerCase()}`}
        />
      </div>

      {ambiguity && (
        <AmbiguityPrompt
          ambiguity={ambiguity}
          choice={entry.dateChoice}
          resolvedDueAt={resolvedDueAtOf(item)}
          allDay={resolvedAllDayOf(item)}
          disabled={disabled}
          idPrefix={idPrefix}
          onChoose={chooseDate}
        />
      )}

      {requirement && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mx-3.5 mb-3 flex w-[calc(100%-1.75rem)] items-center gap-2 rounded-md bg-warning/10 px-3 py-2.5 text-start text-sm text-warning"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span>{requirement}</span>
        </button>
      )}

      {entry.matchedPersonName && item.category === "person" && (
        <div className="mx-3.5 mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
          <UserRoundCheck className="size-4" aria-hidden />
          {entry.useExistingPerson ? (
            <>
              Updates your existing person &ldquo;{entry.matchedPersonName}&rdquo;
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                disabled={disabled}
                onClick={() => onChange({ ...entry, useExistingPerson: false })}
              >
                Create a new person instead
              </Button>
            </>
          ) : (
            <>
              Will be created as a new person
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                disabled={disabled}
                onClick={() => onChange({ ...entry, useExistingPerson: true })}
              >
                Update &ldquo;{entry.matchedPersonName}&rdquo; instead
              </Button>
            </>
          )}
        </div>
      )}

      {showAllergyWarning && (
        <p className="mx-3.5 mb-3 flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Allergy — MeOS will always show this prominently. It&apos;s your own record, not
            medical advice.
          </span>
        </p>
      )}

      <div
        id={`${idPrefix}-editor`}
        hidden={!expanded}
        className="border-t border-hairline px-3.5 py-4"
      >
        {/* The correction lives above the fields it swaps out. `custom` is not
            offered as a target — a type proposal cannot be invented on the
            user's behalf — so leaving custom is a one-way door, which is why
            the current category always appears as a choice. */}
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Field label="Kept as" htmlFor={`${idPrefix}-category`}>
            <Select
              value={item.category}
              disabled={disabled}
              onValueChange={(value) => changeCategory(value as ConversionTarget)}
            >
              <SelectTrigger id={`${idPrefix}-category`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {item.category === "custom" && (
                  <SelectItem value="custom">{CATEGORY_META.custom.label}</SelectItem>
                )}
                {CONVERSION_TARGETS.map((target) => (
                  <SelectItem key={target} value={target}>
                    {CATEGORY_META[target].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        {item.category === "person" && (
          <PersonEditor
            data={item.structuredData}
            onChange={updateData}
            disabled={disabled}
            idPrefix={idPrefix}
          />
        )}
        {item.category === "important_date" && (
          <ImportantDateEditor
            data={item.structuredData}
            onChange={updateData}
            disabled={disabled}
            idPrefix={idPrefix}
          />
        )}
        {item.category === "reminder" && (
          <ReminderEditor
            data={item.structuredData}
            onChange={updateData}
            disabled={disabled}
            idPrefix={idPrefix}
          />
        )}
        {item.category === "food_preference" && (
          <FoodPreferenceEditor
            data={item.structuredData}
            onChange={updateData}
            disabled={disabled}
            idPrefix={idPrefix}
          />
        )}
        {item.category === "recipe" && (
          <RecipeEditor
            data={item.structuredData}
            onChange={updateData}
            disabled={disabled}
            idPrefix={idPrefix}
          />
        )}
        {item.category === "document" && (
          <DocumentEditor
            data={item.structuredData}
            onChange={updateData}
            disabled={disabled}
            idPrefix={idPrefix}
          />
        )}
        {item.category === "note" && (
          <NoteEditor
            data={item.structuredData}
            onChange={updateData}
            disabled={disabled}
            idPrefix={idPrefix}
          />
        )}
        {item.category === "task" && (
          <TaskEditor
            data={item.structuredData}
            onChange={updateData}
            disabled={disabled}
            idPrefix={idPrefix}
          />
        )}
        {item.category === "list" && (
          <ListEditor
            data={item.structuredData}
            onChange={updateData}
            disabled={disabled}
            idPrefix={idPrefix}
          />
        )}
        {item.category === "alarm" && (
          <AlarmEditor
            data={item.structuredData}
            onChange={updateData}
            disabled={disabled}
            idPrefix={idPrefix}
          />
        )}
        {item.category === "event" && (
          <EventEditor
            data={item.structuredData}
            onChange={updateData}
            disabled={disabled}
            idPrefix={idPrefix}
          />
        )}
        {item.category === "custom" && (
          <CustomEditor
            data={item.structuredData}
            onChange={updateData}
            disabled={disabled}
            idPrefix={idPrefix}
          />
        )}

        {item.missingFields.length > 0 && (
          <p className="mt-4 flex items-start gap-1.5 text-sm text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            You didn&apos;t mention: {item.missingFields.join(", ")}. Fill in what you know — MeOS
            never guesses.
          </p>
        )}

        {relatedSummaries.length > 0 && (
          <p className="mt-4 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <Link2 className="size-3.5" aria-hidden />
            Connected to:
            {relatedSummaries.map((summary) => (
              <Badge key={summary} variant="secondary" className="font-normal">
                {summary}
              </Badge>
            ))}
          </p>
        )}

        <blockquote className="mt-4 border-s-2 border-hairline ps-3 text-sm italic text-muted-foreground">
          {item.sourceText}
        </blockquote>
      </div>
    </article>
  );
}
