/**
 * Seeding people from the device address book.
 *
 * The Contact Picker API is the OS doing the work (§6.1): the phone renders
 * its own picker, the user ticks who they mean, and the page receives only
 * those entries. MeOS never holds a contacts permission and never sees the
 * address book — there is nothing to revoke afterwards, because nothing was
 * granted.
 *
 * Only `name` is requested. Numbers and emails have nowhere to live in the
 * `people` table, and asking for data you have no use for is how a permission
 * prompt stops being believable.
 *
 * Chrome on Android only, over HTTPS, and only from a user gesture. It is a
 * one-off import and never a sync: nothing here watches for later changes.
 */

/** One picker session cannot flood the list with a whole address book. */
export const MAX_IMPORTED_CONTACTS = 50;

/** Matches the practical width of a name on the people screen. */
const MAX_NAME_CHARS = 80;

interface PickedContact {
  /** A contact may carry several names — display, phonetic, maiden. */
  name?: string[];
}

interface ContactsManagerLike {
  select(properties: string[], options?: { multiple?: boolean }): Promise<PickedContact[]>;
}

function contactsManager(): ContactsManagerLike | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;
  const scope = navigator as Navigator & { contacts?: ContactsManagerLike };
  // Both checks matter: `navigator.contacts` alone was also the name of an old
  // Cordova plugin with a completely different, callback-shaped API.
  if (!scope.contacts || !("ContactsManager" in window)) return null;
  return scope.contacts;
}

export function supportsContactPicker(): boolean {
  return contactsManager() !== null;
}

/**
 * Opens the OS picker. Resolves to the names ticked, or an empty array when
 * the user backed out. Rejects only if the browser refused to open it at all.
 */
export async function pickContactNames(): Promise<string[]> {
  const manager = contactsManager();
  if (!manager) return [];
  const picked = await manager.select(["name"], { multiple: true });
  return picked.map((contact) => contact.name?.[0] ?? "");
}

/**
 * Cleans a batch of picked names into rows worth inserting.
 *
 * Address books are messy in ways a person never notices until they are the
 * input to a database: blank entries, "  Dana   Levi ", and the same person
 * saved twice with different capitalisation. Deduplicating against the names
 * already saved is what makes a second import add only what is new.
 */
export function normaliseContactNames(
  raw: readonly (string | null | undefined)[],
  existing: readonly string[] = [],
  max: number = MAX_IMPORTED_CONTACTS,
): string[] {
  const seen = new Set(
    existing.map((name) => name.trim().toLowerCase()).filter((name) => name.length > 0),
  );
  const names: string[] = [];

  for (const value of raw) {
    const name = (value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_CHARS);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= max) break;
  }

  return names;
}
