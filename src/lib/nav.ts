import { House, Layers, MessageCircleQuestion, UserRound, type LucideIcon } from "lucide-react";

export interface TabItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Sub-routes that should light this tab up. */
  owns?: string[];
}

/**
 * Four tabs and a capture button — the whole navigation model.
 *
 * The seven category screens used to be seven destinations. They're now
 * reached from the filter rail inside Memory, because the premise of MeOS is
 * that the AI decides where a memory files itself: making the user pick the
 * bucket up front asks them to know something they can't know.
 *
 * `owns` keeps the tab lit when the user drills into a category screen, so
 * they always know which of the four places they're standing in.
 */
export const TAB_ITEMS: TabItem[] = [
  { label: "Today", href: "/", icon: House },
  {
    label: "Memory",
    href: "/memory",
    icon: Layers,
    owns: [
      "/tasks",
      "/lists",
      "/types",
      "/people",
      "/dates",
      "/food",
      "/recipes",
      "/documents",
      "/notes",
      "/vault",
    ],
  },
  { label: "Ask", href: "/ask", icon: MessageCircleQuestion },
  { label: "You", href: "/settings", icon: UserRound },
];

export function isTabActive(tab: TabItem, pathname: string): boolean {
  if (tab.href === "/") return pathname === "/";
  if (pathname === tab.href || pathname.startsWith(`${tab.href}/`)) return true;
  return (tab.owns ?? []).some((base) => pathname === base || pathname.startsWith(`${base}/`));
}
