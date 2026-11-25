import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { apiError, checkRateLimit } from "@/lib/api";
import { isoDateInZone } from "@/lib/temporal/zone";
import {
  ilikeAnyOf,
  refOf,
  resolveCitations,
  searchTerms,
  sourceHref,
  type AskSource,
} from "@/lib/ask/retrieval";
import {
  AI_MODEL_UNAVAILABLE_MESSAGE,
  AI_NOT_CONFIGURED_MESSAGE,
  AiError,
  aiProvider,
  isAiConfigured,
} from "@/lib/ai";
import { embedText, isEmbeddingConfigured } from "@/lib/ai/embeddings";

/**
 * Ask MeOS, Phase 6: targeted retrieval with citations.
 *
 * v1 dumped every table into the prompt bounded by one cap. Now every
 * question gets three layers, all RLS-scoped so one user's data can never
 * appear in another's answer:
 *
 *   1. anchors — the small sets any question might need: people (the join
 *      target of everything), dated rows, recent items;
 *   2. matches — rows whose text matches the question's own words, which is
 *      what makes "which recipes use eggs" pull the right recipes via their
 *      ingredients rather than hoping they landed inside a cap;
 *   3. connections — children and `item_relations` of everything selected,
 *      both endpoints included, so the model can follow an edge it is shown.
 *
 * Every record carries a `ref`; the model cites the refs it used and the
 * route resolves them against what was actually retrieved. An invented ref is
 * dropped, never rendered — a citation is a pointer into the user's own data
 * or it is nothing.
 *
 * Privacy: document numbers are stripped before anything is sent to the AI
 * provider — answering questions never requires them.
 */

const requestSchema = z
  .object({
    question: z.string().trim().min(1, "Ask something first").max(500),
  })
  .strict();

const ASK_LIMIT = 15;
const ASK_WINDOW_MS = 5 * 60 * 1000;

/** Rows any question might need, regardless of wording. */
const ANCHOR_ROWS = 60;
/** Per-table cap on rows matched by the question's own words. */
const MATCH_ROWS = 40;
/** Children of selected parents — list rows, ingredients, preferences. */
const CHILD_ROWS = 240;
/** Recency window for undated items, so "what did I just save" works. */
const RECENT_ROWS = 30;

const ASK_JSON_SCHEMA = {
  name: "meos_ask_answer",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: {
        type: "string",
        description: "The answer, in plain warm sentences. No markdown headers.",
      },
      citations: {
        type: "array",
        items: { type: "string" },
        description:
          "The `ref` values of the records the answer draws on, at most 8. Only refs that appear in the records. Empty when nothing answered the question.",
      },
    },
    required: ["answer", "citations"],
  },
} as const;

const askAnswerSchema = z.object({
  answer: z.string().min(1),
  citations: z.unknown().optional(),
});

type Row = Record<string, unknown>;

/** Merge query results into an id-keyed map, so overlapping layers dedupe. */
function collect(into: Map<string, Row>, rows: Row[] | null | undefined) {
  for (const row of rows ?? []) {
    const id = row.id as string | undefined;
    if (id && !into.has(id)) into.set(id, row);
  }
}

function withRefs(table: string, rows: Map<string, Row>): Row[] {
  return [...rows.values()].map((row) => ({ ref: refOf(table, row.id as string), ...row }));
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return apiError("UNAUTHENTICATED", "Sign in to use MeOS", 401);
  }
  if (!isAiConfigured()) {
    return apiError("NOT_CONFIGURED", AI_NOT_CONFIGURED_MESSAGE, 503);
  }

  const rate = checkRateLimit(user.id, "ask", ASK_LIMIT, ASK_WINDOW_MS);
  if (!rate.allowed) {
    return apiError(
      "RATE_LIMITED",
      `You're going fast — try again in ${rate.retryAfterSeconds} seconds.`,
      429,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_INPUT", "Request body must be JSON", 400);
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  const question = parsed.data.question;
  const terms = searchTerms(question);

  /*
   * The semantic layer: what the question MEANS, not just its words —
   * "what can't Mom eat?" has to land on a peanut allergy that never says
   * "eat". Optional by construction: any failure collapses to the
   * word-matching layers below, and RLS applies inside match_memories.
   */
  const semanticMatches: Promise<{ source: string; id: string; distance: number }[]> =
    isEmbeddingConfigured()
      ? embedText(question, "RETRIEVAL_QUERY")
          .then(async (vector) => {
            if (!vector) return [];
            const { data, error } = await supabase.rpc("match_memories", {
              query_embedding: JSON.stringify(vector),
              match_count: 12,
            });
            if (error) {
              console.error("[ask] match_memories failed:", error.message);
              return [];
            }
            return (data ?? []) as { source: string; id: string; distance: number }[];
          })
          .catch(() => [])
      : Promise.resolve([]);

  const ITEM_COLUMNS =
    "id, type_key, capability, title, summary, status, due_at, all_day, starts_at, ends_at, tags, attributes";

  /* ---- layer 1 + 2: anchors and term matches, in one parallel round ------- */

  const matched = <T extends { or: (f: string) => T; limit: (n: number) => T }>(
    query: T,
    columns: string[],
  ): T | null => {
    const filter = ilikeAnyOf(columns, terms);
    return filter ? query.or(filter).limit(MATCH_ROWS) : null;
  };

  const [
    profile,
    people,
    generalPrefs,
    dates,
    reminders,
    foodPrefs,
    recipesRecent,
    recipesMatched,
    ingredientsMatched,
    documents,
    notesRecent,
    notesMatched,
    itemsDue,
    itemsRecent,
    itemsMatched,
    listRowsMatched,
  ] = await Promise.all([
    supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
    // People are the join target of preferences, dates and food — and a
    // personal address book is small — so they are always an anchor.
    supabase
      .from("people")
      .select("id, name, relationship, birthday, birthday_year_known, notes")
      .limit(ANCHOR_ROWS),
    supabase.from("person_preferences").select("person_id, preference_type, value").limit(CHILD_ROWS),
    supabase
      .from("important_dates")
      .select("id, title, event_date, year_known, recurrence, person_id, notes")
      .limit(ANCHOR_ROWS),
    supabase
      .from("reminders")
      .select("id, title, remind_at, completed")
      .order("remind_at", { ascending: false })
      .limit(ANCHOR_ROWS),
    supabase
      .from("food_preferences")
      .select("id, person_id, food_name, preference_type, severity, notes")
      .limit(ANCHOR_ROWS),
    supabase.from("recipes").select("id, name, description, servings").limit(RECENT_ROWS),
    matched(supabase.from("recipes").select("id, name, description, servings"), [
      "name",
      "description",
    ]),
    // Ingredient matches are how "which recipes use eggs" finds its recipes.
    matched(
      supabase.from("recipe_ingredients").select("recipe_id, ingredient_name, quantity, unit, optional"),
      ["ingredient_name"],
    ),
    supabase
      // document_number deliberately NOT selected — it never leaves the DB here.
      .from("documents")
      .select("id, display_name, document_type, issue_date, expiration_date, issuing_country, notes")
      .limit(ANCHOR_ROWS),
    supabase.from("notes").select("id, title, content, note_type, pinned").limit(RECENT_ROWS),
    matched(supabase.from("notes").select("id, title, content, note_type, pinned"), [
      "title",
      "content",
      "note_type",
    ]),
    supabase
      .from("items")
      .select(ITEM_COLUMNS)
      .eq("status", "active")
      .not("due_at", "is", null)
      .order("due_at", { ascending: true })
      .limit(ANCHOR_ROWS),
    supabase.from("items").select(ITEM_COLUMNS).order("created_at", { ascending: false }).limit(RECENT_ROWS),
    matched(supabase.from("items").select(ITEM_COLUMNS), ["title", "summary"]),
    // A list is found by what is on it as much as by its name.
    matched(supabase.from("list_items").select("id, list_id, position, text, quantity, unit, checked_at"), [
      "text",
    ]),
  ]);

  const recipeRows = new Map<string, Row>();
  collect(recipeRows, recipesRecent.data);
  collect(recipeRows, recipesMatched?.data);

  const itemRows = new Map<string, Row>();
  collect(itemRows, itemsDue.data);
  collect(itemRows, itemsRecent.data);
  collect(itemRows, itemsMatched?.data);

  const noteRows = new Map<string, Row>();
  collect(noteRows, notesRecent.data);
  collect(noteRows, notesMatched?.data);

  /* ---- layer 3: connections of everything selected ------------------------ */

  const ingredientRecipeIds = [
    ...new Set(
      (ingredientsMatched?.data ?? [])
        .map((row) => row.recipe_id as string)
        .filter((id) => !recipeRows.has(id)),
    ),
  ];
  const matchedListIds = [
    ...new Set(
      (listRowsMatched?.data ?? [])
        .map((row) => row.list_id as string)
        .filter((id) => !itemRows.has(id)),
    ),
  ];
  /*
   * Capped, matched-and-due ids first: every id appears twice in the `.or()`
   * filter, and an uncapped list (up to ~170 ids) builds a query string long
   * enough for a gateway to refuse with 414 — silently, since PostgREST
   * errors surface as empty data.
   */
  const relationIds = [...new Set([...itemRows.keys(), ...matchedListIds])].slice(0, 60);

  /*
   * Past this distance a "match" is the nearest stranger, not a relative —
   * top-N alone would happily return noise for a question about nothing the
   * user ever saved.
   */
  const SEMANTIC_MAX_DISTANCE = 0.55;
  const semantic = (await semanticMatches).filter((m) => m.distance <= SEMANTIC_MAX_DISTANCE);
  const semanticItemIds = semantic
    .filter((m) => m.source === "items" && !itemRows.has(m.id))
    .map((m) => m.id);
  const semanticNoteIds = semantic
    .filter((m) => m.source === "notes" && !noteRows.has(m.id))
    .map((m) => m.id);

  const [recipesFromIngredients, listParents, relations, semanticItems, semanticNotes] =
    await Promise.all([
    ingredientRecipeIds.length > 0
      ? supabase.from("recipes").select("id, name, description, servings").in("id", ingredientRecipeIds)
      : Promise.resolve({ data: [] as Row[], error: null }),
    matchedListIds.length > 0
      ? supabase.from("items").select(ITEM_COLUMNS).in("id", matchedListIds)
      : Promise.resolve({ data: [] as Row[], error: null }),
    relationIds.length > 0
      ? supabase
          .from("item_relations")
          .select("from_item, to_item, to_legacy_table, to_legacy_id, relation")
          .or(`from_item.in.(${relationIds.join(",")}),to_item.in.(${relationIds.join(",")})`)
          .limit(100)
      : Promise.resolve({ data: [] as Row[], error: null }),
    semanticItemIds.length > 0
      ? supabase.from("items").select(ITEM_COLUMNS).in("id", semanticItemIds)
      : Promise.resolve({ data: [] as Row[], error: null }),
    semanticNoteIds.length > 0
      ? supabase
          .from("notes")
          .select("id, title, content, note_type, pinned")
          .in("id", semanticNoteIds)
      : Promise.resolve({ data: [] as Row[], error: null }),
  ]);

  // A degraded answer beats a failed one, but a silent degrade helps nobody.
  if (relations.error) console.error("[ask] item_relations failed:", relations.error.message);

  collect(recipeRows, recipesFromIngredients.data);
  collect(itemRows, listParents.data);
  collect(itemRows, semanticItems.data);
  collect(noteRows, semanticNotes.data);

  // An edge is only useful when both ends are visible.
  const missingEndpoints = [
    ...new Set(
      (relations.data ?? [])
        .flatMap((edge) => [edge.from_item as string | null, edge.to_item as string | null])
        .filter((id): id is string => Boolean(id) && !itemRows.has(id as string)),
    ),
  ];

  const allRecipeIds = [...recipeRows.keys()];
  const allListIds = [...itemRows.values()]
    .filter((row) => row.capability === "list")
    .map((row) => row.id as string);

  const [endpointItems, ingredientsOfSelected, listRowsOfSelected] = await Promise.all([
    missingEndpoints.length > 0
      ? supabase.from("items").select(ITEM_COLUMNS).in("id", missingEndpoints).limit(ANCHOR_ROWS)
      : Promise.resolve({ data: [] as Row[] }),
    allRecipeIds.length > 0
      ? supabase
          .from("recipe_ingredients")
          .select("recipe_id, ingredient_name, quantity, unit, optional")
          .in("recipe_id", allRecipeIds)
          .limit(CHILD_ROWS)
      : Promise.resolve({ data: [] as Row[] }),
    allListIds.length > 0
      ? supabase
          .from("list_items")
          .select("list_id, position, text, quantity, unit, checked_at")
          .in("list_id", allListIds)
          .order("position", { ascending: true })
          .limit(CHILD_ROWS)
      : Promise.resolve({ data: [] as Row[] }),
  ]);

  collect(itemRows, endpointItems.data);

  /*
   * Rows that matched the question's own words must survive into the context:
   * the bulk per-parent refetches are capped, and a cap that silently drops
   * the one row the user asked about defeats the whole retrieval layer.
   */
  const mergeRows = (primary: Row[], secondary: Row[], keyOf: (row: Row) => string): Row[] => {
    const seen = new Set<string>();
    const merged: Row[] = [];
    for (const row of [...primary, ...secondary]) {
      const key = keyOf(row);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
      if (merged.length >= CHILD_ROWS) break;
    }
    return merged;
  };
  const contextIngredients = mergeRows(
    (ingredientsMatched?.data ?? []) as Row[],
    ingredientsOfSelected.data ?? [],
    (row) => `${row.recipe_id}|${row.ingredient_name}`,
  );
  const contextListRows = mergeRows(
    (listRowsMatched?.data ?? []) as Row[],
    listRowsOfSelected.data ?? [],
    (row) => `${row.list_id}|${row.position}`,
  );

  /* ---- refs, context, and the one model call ------------------------------ */

  const known = new Map<string, AskSource>();
  const register = (table: string, rows: Map<string, Row> | Row[], kind: (row: Row) => string, label: (row: Row) => string) => {
    const list = rows instanceof Map ? [...rows.values()] : rows;
    for (const row of list) {
      const ref = refOf(table, row.id as string);
      known.set(ref, {
        ref,
        kind: kind(row),
        label: label(row).slice(0, 80),
        href: sourceHref(table, row),
      });
    }
  };

  register("people", people.data ?? [], () => "person", (r) => String(r.name ?? "Someone"));
  register("important_dates", dates.data ?? [], () => "date", (r) => String(r.title ?? "A date"));
  register("reminders", reminders.data ?? [], () => "reminder", (r) => String(r.title ?? "A reminder"));
  register("food_preferences", foodPrefs.data ?? [], () => "food", (r) => String(r.food_name ?? "A food note"));
  register("recipes", recipeRows, () => "recipe", (r) => String(r.name ?? "A recipe"));
  register("documents", documents.data ?? [], () => "document", (r) => String(r.display_name ?? "A document"));
  register("notes", noteRows, () => "note", (r) => String(r.title ?? r.content ?? "A note"));
  register(
    "items",
    itemRows,
    (r) => String(r.capability ?? "item"),
    (r) => String(r.title ?? "An item"),
  );

  const timeZone = (profile.data?.timezone as string | null) ?? "UTC";

  const context = {
    // The user's today, not the server's — a UTC host is a different day from
    // an Asia/Jerusalem evening, and "what's due today" is the commonest question.
    today: isoDateInZone(new Date(), timeZone),
    timezone: timeZone,
    people: withRefs("people", new Map((people.data ?? []).map((r) => [r.id as string, r as Row]))),
    person_preferences: generalPrefs.data ?? [],
    important_dates: withRefs("important_dates", new Map((dates.data ?? []).map((r) => [r.id as string, r as Row]))),
    reminders: withRefs("reminders", new Map((reminders.data ?? []).map((r) => [r.id as string, r as Row]))),
    food_preferences: withRefs("food_preferences", new Map((foodPrefs.data ?? []).map((r) => [r.id as string, r as Row]))),
    recipes: withRefs("recipes", recipeRows),
    recipe_ingredients: contextIngredients,
    documents: withRefs("documents", new Map((documents.data ?? []).map((r) => [r.id as string, r as Row]))),
    notes: withRefs("notes", noteRows),
    items: withRefs("items", itemRows),
    list_items: contextListRows,
    item_relations: relations.data ?? [],
  };

  const systemPrompt = `You are MeOS, the user's private personal memory assistant.
Answer the user's question using ONLY the JSON records below. They are the user's own saved data, selected for this question.

Rules:
- Be concise and warm. Plain sentences, no markdown headers.
- If the records don't contain the answer, say you don't have that saved yet — never guess.
- Dates with "year_known": false have a placeholder year of 2000; mention only month and day for those.
- Fields named person_id reference the "people" list by id.
- "items" holds tasks, lists, alarms, events and other saved things. capability says which. status "done" means finished — don't report those as outstanding, and treat a due_at in the past on an "active" item as overdue.
- An event's moment is starts_at (ends_at when known), not due_at; a past event is over, not overdue.
- "list_items" are the entries of a list: list_id references items by id, and checked_at set means already ticked off.
- "item_relations" are edges between items (from_item/to_item reference items by id) — use them to connect a task to its list, a reminder to its document.
- Some items are memory records: type_key "belonging" says where a thing is kept (attributes.location — quote it when asked "where is..."), "loan" tracks who has what (attributes.who and attributes.direction), "size" holds sizes (attributes.person, attributes.kind, attributes.value).
- Health records: "medication" (attributes.dose, attributes.schedule), "vaccination" and "health_note" — their due_at is WHEN IT HAPPENED, so "when did I last..." reads the most recent one. Report what is recorded, never advise.
- Timestamps are UTC; the user's timezone is given above, so convert before naming a time of day.
- Never give medical, legal, or financial advice — for allergies you may repeat what is recorded, adding that it's their own record.
- Most records carry a "ref". Put the refs of the records your answer draws on into "citations" — at most 8, only refs that exist in the records, an empty array when nothing answered.

User's records:
${JSON.stringify(context)}`;

  try {
    const raw = await aiProvider().generateJson({
      systemPrompt,
      userText: question,
      schema: ASK_JSON_SCHEMA.schema as unknown as Record<string, unknown>,
      schemaName: ASK_JSON_SCHEMA.name,
    });

    const result = askAnswerSchema.safeParse(raw);
    if (!result.success) {
      return apiError("PROVIDER_ERROR", "The AI service gave an unusable answer. Try again.", 502);
    }

    return NextResponse.json({
      answer: result.data.answer,
      sources: resolveCitations(result.data.citations, known),
    });
  } catch (error) {
    if (error instanceof AiError && error.code === "QUOTA_EXCEEDED") {
      return apiError(
        "RATE_LIMITED",
        "You've hit today's free AI quota. It resets daily — try again tomorrow, or browse your records directly.",
        429,
      );
    }
    if (error instanceof AiError && error.code === "NOT_CONFIGURED") {
      return apiError("NOT_CONFIGURED", AI_NOT_CONFIGURED_MESSAGE, 503);
    }
    if (error instanceof AiError && error.code === "MODEL_UNAVAILABLE") {
      return apiError("NOT_CONFIGURED", AI_MODEL_UNAVAILABLE_MESSAGE, 503);
    }
    return apiError(
      "PROVIDER_ERROR",
      "The AI service is having a moment — it usually passes within a minute. Try again.",
      502,
    );
  }
}
