import {
  Box, Calendar, Car, Check, Clipboard, Coins, CupSoda, Dumbbell, FileText, Gift, Globe,
  GraduationCap, Hammer, Heart, Home, Key, Landmark, Laptop, Leaf, Lightbulb, List, MapPin,
  Music, Package, PawPrint, Pill, Plane, Receipt, Repeat, Shield, ShoppingCart, Sparkles,
  Stethoscope, Ticket, Tv, User, Users, Wallet, Wrench,
  type LucideIcon,
} from "lucide-react";
import { TYPE_ICONS, TYPE_COLORS, type TypeColor, type TypeIcon } from "./types";

/**
 * The approved icon set, resolved to components.
 *
 * `item_types.icon` is a string chosen by the model from a closed list that
 * Postgres also enforces (`meos_allowed_icons()`), so a type can never carry an
 * icon the app cannot draw. This is where that string becomes something React
 * can render — the missing half that made a custom type's chosen icon
 * unusable anywhere outside the proposal card.
 */
const ICONS: Record<TypeIcon, LucideIcon> = {
  box: Box, calendar: Calendar, car: Car, check: Check, clipboard: Clipboard, coins: Coins,
  "cup-soda": CupSoda, dumbbell: Dumbbell, "file-text": FileText, gift: Gift, globe: Globe,
  "graduation-cap": GraduationCap, hammer: Hammer, heart: Heart, home: Home, key: Key,
  landmark: Landmark, laptop: Laptop, leaf: Leaf, lightbulb: Lightbulb, list: List,
  "map-pin": MapPin, music: Music, package: Package, "paw-print": PawPrint, pill: Pill,
  plane: Plane, receipt: Receipt, repeat: Repeat, shield: Shield, "shopping-cart": ShoppingCart,
  sparkles: Sparkles, stethoscope: Stethoscope, ticket: Ticket, tv: Tv, user: User, users: Users,
  wallet: Wallet, wrench: Wrench,
};

/** Box is the fallback: a type whose icon string is unknown still renders. */
export function iconForType(icon: string): LucideIcon {
  return ICONS[icon as TypeIcon] ?? Box;
}

/**
 * Colour tokens, resolved to the same chip classes `CATEGORY_META` uses, so a
 * custom type sits beside a core one without looking like a different app.
 */
const CHIP_CLASSES: Record<TypeColor, string> = {
  person: "bg-cat-person/10 text-cat-person",
  date: "bg-cat-date/10 text-cat-date",
  reminder: "bg-cat-reminder/10 text-cat-reminder",
  food: "bg-cat-food/10 text-cat-food",
  recipe: "bg-cat-recipe/10 text-cat-recipe",
  document: "bg-cat-document/10 text-cat-document",
  note: "bg-cat-note/10 text-cat-note",
  accent: "bg-primary/10 text-primary",
  neutral: "bg-secondary text-secondary-foreground",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
};

export function chipClassForType(color: string): string {
  return CHIP_CLASSES[color as TypeColor] ?? CHIP_CLASSES.neutral;
}

/** Guards against the two maps drifting from the lists Postgres enforces. */
export const ICON_COVERAGE = { icons: TYPE_ICONS.length, colors: TYPE_COLORS.length } as const;
export const ICON_MAP_SIZE = Object.keys(ICONS).length;
export const COLOR_MAP_SIZE = Object.keys(CHIP_CLASSES).length;
