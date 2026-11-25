import {
  AlarmClock,
  BellRing,
  CalendarClock,
  CalendarHeart,
  ChefHat,
  CircleCheck,
  IdCard,
  ListChecks,
  Sparkles,
  StickyNote,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

/** Extraction categories produced by the AI. */
export type ExtractionCategory =
  | "person"
  | "important_date"
  | "reminder"
  | "food_preference"
  | "recipe"
  | "document"
  | "note"
  /** v2 capabilities, stored in `items` rather than a dedicated table. */
  | "task"
  | "list"
  | "alarm"
  | "event"
  /**
   * A type the user approved into existence. The metadata below is the
   * fallback the confirmation card uses before the type exists; once saved,
   * the real icon and colour come from the `item_types` row.
   */
  | "custom";

interface CategoryMeta {
  label: string;
  /** Plural label used on list screens. */
  pluralLabel: string;
  /** Short form for filter chips and tab bars, where space is tight. */
  chipLabel: string;
  icon: LucideIcon;
  /** Tailwind text-color class from the category token. */
  textClass: string;
  /** Soft background class for badges/icon chips. */
  softBgClass: string;
  /** Both of the above — what `ListRow`'s icon chip wants. */
  chipClass: string;
  /** Screen that owns this category. */
  href: string;
}

export const CATEGORY_META: Record<ExtractionCategory, CategoryMeta> = {
  person: {
    label: "Person",
    pluralLabel: "People",
    chipLabel: "People",
    icon: Users,
    textClass: "text-cat-person",
    softBgClass: "bg-cat-person/10",
    chipClass: "bg-cat-person/10 text-cat-person",
    href: "/people",
  },
  important_date: {
    label: "Important date",
    pluralLabel: "Important dates",
    chipLabel: "Dates",
    icon: CalendarHeart,
    textClass: "text-cat-date",
    softBgClass: "bg-cat-date/10",
    chipClass: "bg-cat-date/10 text-cat-date",
    href: "/dates",
  },
  reminder: {
    label: "Reminder",
    pluralLabel: "Reminders",
    chipLabel: "Reminders",
    icon: BellRing,
    textClass: "text-cat-reminder",
    softBgClass: "bg-cat-reminder/10",
    chipClass: "bg-cat-reminder/10 text-cat-reminder",
    href: "/dates",
  },
  food_preference: {
    label: "Food preference",
    pluralLabel: "Food preferences",
    chipLabel: "Food",
    icon: UtensilsCrossed,
    textClass: "text-cat-food",
    softBgClass: "bg-cat-food/10",
    chipClass: "bg-cat-food/10 text-cat-food",
    href: "/food",
  },
  recipe: {
    label: "Recipe",
    pluralLabel: "Recipes",
    chipLabel: "Recipes",
    icon: ChefHat,
    textClass: "text-cat-recipe",
    softBgClass: "bg-cat-recipe/10",
    chipClass: "bg-cat-recipe/10 text-cat-recipe",
    href: "/recipes",
  },
  document: {
    label: "Document",
    pluralLabel: "Documents",
    chipLabel: "Docs",
    icon: IdCard,
    textClass: "text-cat-document",
    softBgClass: "bg-cat-document/10",
    chipClass: "bg-cat-document/10 text-cat-document",
    href: "/documents",
  },
  note: {
    label: "Note",
    pluralLabel: "Notes",
    chipLabel: "Notes",
    icon: StickyNote,
    textClass: "text-cat-note",
    softBgClass: "bg-cat-note/10",
    chipClass: "bg-cat-note/10 text-cat-note",
    href: "/notes",
  },
  // Tasks and lists are the two things you *act on*, so they carry the single
  // accent colour rather than a category hue — they belong with the primary
  // action, not with the reference material.
  task: {
    label: "Task",
    pluralLabel: "Tasks",
    chipLabel: "Tasks",
    icon: CircleCheck,
    textClass: "text-primary",
    softBgClass: "bg-primary/10",
    chipClass: "bg-primary/10 text-primary",
    href: "/tasks",
  },
  list: {
    label: "List",
    pluralLabel: "Lists",
    chipLabel: "Lists",
    icon: ListChecks,
    textClass: "text-primary",
    softBgClass: "bg-primary/10",
    chipClass: "bg-primary/10 text-primary",
    href: "/lists",
  },
  // An alarm interrupts, so it borrows the reminder hue rather than the accent:
  // it is not something you work through, it is something that happens to you.
  alarm: {
    label: "Alarm",
    pluralLabel: "Alarms",
    chipLabel: "Alarms",
    icon: AlarmClock,
    textClass: "text-cat-reminder",
    softBgClass: "bg-cat-reminder/10",
    chipClass: "bg-cat-reminder/10 text-cat-reminder",
    href: "/tasks",
  },
  // An event borrows the date hue: it lives on the calendar, not on the todo
  // list — something you attend rather than something you finish.
  event: {
    label: "Event",
    pluralLabel: "Events",
    chipLabel: "Events",
    icon: CalendarClock,
    textClass: "text-cat-date",
    softBgClass: "bg-cat-date/10",
    chipClass: "bg-cat-date/10 text-cat-date",
    href: "/types/event",
  },
  custom: {
    label: "New type",
    pluralLabel: "New types",
    chipLabel: "New",
    icon: Sparkles,
    textClass: "text-accent-foreground",
    softBgClass: "bg-accent",
    chipClass: "bg-accent text-accent-foreground",
    href: "/memory",
  },
};

/**
 * Order of the filter rail under the Memory tab. `reminder` is omitted
 * because reminders and important dates share one screen — showing both
 * chips would send two labels to the same place, and `alarm` is omitted for
 * the same reason now that alarms live on the tasks screen.
 *
 * Tasks and lists lead, because they are the two things you act on rather than
 * look up, and a rail is read left to right.
 */
export const BROWSE_CATEGORIES: ExtractionCategory[] = [
  "task",
  "list",
  "person",
  "important_date",
  "food_preference",
  "recipe",
  "document",
  "note",
];
