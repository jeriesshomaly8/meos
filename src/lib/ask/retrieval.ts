/**
 * The deterministic half of Ask's targeted retrieval.
 *
 * Term extraction and citation resolution are pure functions here so they are
 * testable without a database or a model. The route composes them: terms pick
 * which rows are worth sending, refs let the model point at the rows it used,
 * and resolution throws away any ref it invented.
 *
 * Retrieval is ILIKE over the caller's own rows, not full-text search, on
 * purpose: the legacy tables have no text indexes at all and `items`' GIN
 * index is an expression index PostgREST cannot target. At personal scale —
 * hundreds of rows, RLS-scoped — a sequential scan is microseconds, and the
 * day that stops being true the fix is a search RPC, not a cleverer client.
 */

/**
 * Words that select nothing. Mostly question scaffolding ("what does…") and
 * time words — time questions are answered by the always-included
 * time-anchored rows, not by matching the word "month" against titles.
 */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "not", "no", "of", "in", "on", "at", "to", "for",
  "with", "about", "from", "by", "up", "out", "into", "over", "under",
  "i", "me", "my", "mine", "we", "our", "you", "your", "it", "its", "they", "their",
  "is", "are", "was", "were", "be", "been", "being", "am",
  "do", "does", "did", "done", "have", "has", "had", "having",
  "will", "would", "can", "could", "should", "shall", "may", "might", "must",
  "what", "whats", "when", "whens", "where", "wheres", "which", "who", "whos",
  "whom", "whose", "how", "hows", "why", "whys",
  "this", "that", "these", "those", "there", "theres", "here",
  "any", "some", "all", "every", "each", "much", "many", "more", "most",
  "get", "got", "go", "going", "come", "coming", "still", "yet", "again",
  "save", "saved", "know", "known", "tell", "told", "show", "list", "lists",
  "thing", "things", "stuff",
  "today", "tomorrow", "yesterday", "tonight", "now", "soon", "next", "last",
  "week", "weeks", "month", "months", "year", "years", "day", "days", "date", "dates",
  "upcoming", "due", "left", "ago",
]);

const MAX_TERMS = 8;

/**
 * The words worth searching for, lowercased and stripped to letters and
 * digits — which is also what makes them safe to embed in a PostgREST `.or()`
 * filter, whose syntax breaks on commas, dots and parentheses.
 */
export function searchTerms(question: string): string[] {
  const tokens = question
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));

  const seen = new Set<string>();
  const terms: string[] = [];
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    terms.push(token);
    if (terms.length >= MAX_TERMS) break;
  }
  return terms;
}

/**
 * A PostgREST `.or()` filter matching any term in any column, or null when
 * there is nothing to match. Terms come from `searchTerms`, which guarantees
 * they contain no `.or()` metacharacters.
 */
export function ilikeAnyOf(columns: string[], terms: string[]): string | null {
  if (terms.length === 0 || columns.length === 0) return null;
  return terms
    .flatMap((term) => columns.map((column) => `${column}.ilike.*${term}*`))
    .join(",");
}

/** A row's stable citation handle: table-qualified so ids can never collide. */
export function refOf(table: string, id: string): string {
  return `${table}:${id}`;
}

/** What the client renders for one cited record. */
export interface AskSource {
  ref: string;
  /** Human wording for what kind of record this is ("person", "task"…). */
  kind: string;
  /** The record's own name — never model text. */
  label: string;
  /**
   * Where the record lives, so the chip is a door and not a decoration —
   * an answer you can walk into. Null when the record has no screen.
   */
  href?: string | null;
}

/** The screen a cited record lives on, per table (items decide by capability). */
export function sourceHref(table: string, row: Record<string, unknown>): string | null {
  switch (table) {
    case "people":
      return `/people/${row.id}`;
    case "recipes":
      return `/recipes/${row.id}`;
    case "documents":
      return "/documents";
    case "notes":
      return "/notes";
    case "important_dates":
    case "reminders":
      return "/dates";
    case "food_preferences":
      return "/food";
    case "items":
      switch (row.capability) {
        case "task":
        case "alarm":
          return "/tasks";
        case "list":
          return "/lists";
        case "event":
          return "/types/event";
        case "record":
          return typeof row.type_key === "string" ? `/types/${row.type_key}` : "/memory";
        default:
          return "/memory";
      }
    default:
      return null;
  }
}

/**
 * Maps the model's citation list onto records that were actually retrieved.
 * Anything else — an invented id, a duplicate, a non-string — is dropped
 * silently: a citation is a pointer into the user's own data or it is nothing.
 */
export function resolveCitations(raw: unknown, known: Map<string, AskSource>): AskSource[] {
  if (!Array.isArray(raw)) return [];
  const sources: AskSource[] = [];
  const seen = new Set<string>();
  for (const candidate of raw) {
    if (typeof candidate !== "string" || seen.has(candidate)) continue;
    const source = known.get(candidate);
    if (!source) continue;
    seen.add(candidate);
    sources.push(source);
    if (sources.length >= 8) break;
  }
  return sources;
}
