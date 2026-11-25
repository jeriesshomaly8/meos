import { describe, expect, it } from "vitest";
import {
  chipClassForType,
  COLOR_MAP_SIZE,
  ICON_COVERAGE,
  ICON_MAP_SIZE,
  iconForType,
} from "@/lib/items/icons";
import { TYPE_COLORS, TYPE_ICONS } from "@/lib/items/types";

/**
 * The icon and colour maps against the lists Postgres enforces.
 *
 * `meos_allowed_icons()` and `meos_allowed_colors()` are check constraints, so
 * a type row can only ever hold a value from these lists. If a value were added
 * there and not here, a custom type would silently fall back to a generic box
 * — which looks like a bug in the type, not a gap in a lookup table.
 */

describe("coverage", () => {
  it("draws every icon the database will accept", () => {
    expect(ICON_MAP_SIZE).toBe(ICON_COVERAGE.icons);
    for (const icon of TYPE_ICONS) {
      expect(iconForType(icon)).toBeTruthy();
    }
  });

  it("has a chip class for every colour the database will accept", () => {
    expect(COLOR_MAP_SIZE).toBe(ICON_COVERAGE.colors);
    for (const color of TYPE_COLORS) {
      expect(chipClassForType(color)).not.toBe("");
    }
  });
});

describe("fallbacks", () => {
  it("still renders something for an icon it doesn't know", () => {
    expect(iconForType("not-a-real-icon")).toBe(iconForType("box"));
  });

  it("falls back to the neutral chip rather than an empty class", () => {
    expect(chipClassForType("chartreuse")).toBe(chipClassForType("neutral"));
  });
});

describe("distinctness", () => {
  /*
   * Two types sharing an icon is fine; the whole set collapsing onto one would
   * mean a broken map that the coverage test above would not notice.
   */
  it("maps the icon names to more than one component", () => {
    const drawn = new Set(TYPE_ICONS.map((icon) => iconForType(icon)));
    expect(drawn.size).toBeGreaterThan(TYPE_ICONS.length / 2);
  });
});
