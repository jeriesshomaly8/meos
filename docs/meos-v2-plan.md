# MeOS v2 — audit and target architecture

Status: **Phases 1–6 complete (Phase 3's envelope refactor deliberately
dropped, see below); Phase 9 complete in code including the push path; §6.3
integrations A, B, D, E and G built, C code-complete. First real-device
session 2026-08-11 (iPhone only) — install, login and dictation confirmed;
Android untested, so A, D and G remain unverified.** Running checklist at the
end, device findings in §10.1.

**Deployed 2026-08-12** to Vercel (`meos-jeriesshomaly8-6715s-projects
.vercel.app`). The push path needs three one-time deployment steps (env vars,
hosted migrations 0011–0012, the cron schedule) — see item 0 of "Next task".

Source of truth for this audit is the code and the four applied migrations, not
`docs/OVERVIEW.md` or `README.md`. Where they disagree, the code wins and the
disagreement is noted.

---

## 1. Current architecture

### 1.1 Data layer — 11 tables, no universal layer

`supabase/migrations/20260809000001_schema.sql`

| Table | Purpose | Temporal columns | Status/completion |
| --- | --- | --- | --- |
| `profiles` | display name, **timezone** | — | — |
| `people` | person records | `birthday date` | — |
| `person_preferences` | non-food likes/dislikes | — | — |
| `important_dates` | birthdays, anniversaries | `event_date date`, `recurrence 'none'\|'yearly'` | — |
| `reminders` | nudges | `remind_at timestamptz` | `completed boolean` |
| `food_preferences` | likes/allergies/diets | — | — |
| `recipes` + `recipe_ingredients` | cookbook | — | — |
| `documents` | wallet, expiries | `issue_date`, `expiration_date` | — |
| `notes` | everything else | — | `pinned` |
| `inbox_entries` | raw capture audit trail | — | `processing_status` |
| `entity_links` | generic edges | — | — |

### 1.2 What's actually missing

- **No `task`.** Nothing in the schema can be *done*. `reminders.completed` is
  the only completion flag in the database, and a reminder is a notification,
  not a unit of work.
- **No `list` / `list_item`.** `recipe_ingredients` is the only ordered child
  collection and it is hardwired to recipes.
- **No `event`.** `important_dates.event_date` is a bare `date` — no time, no
  end, no duration, no location, no attendees. "Dinner with Dana at 8" cannot
  be represented.
- **Recurrence is a two-value enum** (`none` | `yearly`). "Every year on 4 May"
  fits by luck; "every second Tuesday" cannot be stored at all.
- **`entity_links` is dead weight.** It exists, `save_extracted_items()` writes
  to it, and **no screen ever reads it**. Relationships are effectively
  write-only.
- **No status, priority, or tags** anywhere.

### 1.3 Extraction — a classifier, not an interpreter

`src/lib/extraction/`

`extractedItemSchema` is a `z.discriminatedUnion("category", …)` over exactly
seven literals. The model's only structural decision is *which of seven boxes*.
There is no intent layer, so "make me a shopping list" and "I bought milk"
produce the same shape of output.

The fallback is explicit and is the root cause of the reported failure. From
`prompt.ts:22`:

> `- note: ideas, memories, places, gift ideas, or anything meaningful that fits nowhere else.`

Anything unrecognised is *instructed* to become a note.

**Logic that belongs in code is delegated to the LLM.** `prompt.ts:33` tells the
model to resolve "next Friday", "in six months" and "tomorrow" itself, and
`prompt.ts:42` asks it to do date arithmetic ("event date minus six months, at
09:00 local"). The model returns an ISO string that nothing re-derives or
cross-checks. This is non-deterministic, untestable without a live API call,
and the direct cause of dates that don't line up with the Today screen.

**Ambiguity has nowhere to go.** `confidence` is a single number per item;
there is no per-field confidence, no `needsClarification`, and no way to say
"'next Friday' could mean the 14th or the 21st". The UI reduces the number to
the string "worth a check".

### 1.4 Save path

`save_extracted_items(payload jsonb)` — `security invoker`, one transaction,
`user_id` always from `auth.uid()`. This part is sound and worth preserving.

Its limitation is `category_order`, a hardcoded `text[]` at line 54 with a
`case cat when …` dispatch. **Every new type requires editing this function.**

### 1.5 Category metadata is duplicated four times

The same seven categories are declared independently in:

1. `src/lib/categories.ts` — `CATEGORY_META`
2. `src/lib/extraction/schema.ts` — the Zod discriminated union
3. `src/lib/extraction/json-schema.ts` — `EXTRACTION_JSON_SCHEMA`
4. `20260809000003_save_extraction.sql` — `category_order` + `case`

Adding a type means four coordinated edits plus a deployment. This is the
structural reason "new useful categories cannot be created dynamically".

### 1.6 Timezone correctness bug

`profiles.timezone` is captured, passed to the extraction prompt, and then
**ignored by every read path**. `src/app/(app)/page.tsx` computes
`const today = new Date()` — the *server's* clock — and `daysUntil()` in
`src/lib/dates.ts:58` uses `startOfDay()` with no zone. On a Vercel box running
UTC, a user in Asia/Jerusalem sees the wrong day boundary for three hours every
evening. This must be fixed regardless of the rest of the upgrade.

### 1.7 UI limitations

- `CategoryRail` renders a fixed array from `BROWSE_CATEGORIES`. It cannot grow
  past ~8 chips without becoming an unusable scroll.
- The confirmation sheet presents *cards*, one per item, with no notion of a
  plan: no relationship display, no type correction, no merge, no external
  action, no ambiguity resolution.
- Today merges three sources but shows no actionable state — nothing to tick.

### 1.8 Copy audit — confirmed generic strings

| Location | Current | Problem |
| --- | --- | --- |
| `item-card.tsx` | "worth a check" | Says nothing about *what* is uncertain |
| `error.tsx` | "Something went wrong" | Named in the brief as banned |
| `capture-sheet.tsx` | "Saved 3 things" | Doesn't say what |
| `confirmation-panel.tsx` | "MeOS picked out 3 things." | Restates the count, not the content |
| `memory-browser.tsx` | subtitle = category label | Repeats the type back |

---

## 2. Target architecture

### 2.1 Guiding decision

**Additive universal layer beside the existing tables. No data migration, no
dual-write.**

Considered and rejected:

- *Migrate all 7 tables into one `items` table.* Cleanest end state, but it
  rewrites every screen, every query and the save function at once, and risks
  existing data. Violates "do not rebuild everything".
- *Keep 7 tables and add more specialised tables per new type.* No growth
  story; the brief explicitly rules it out.

**Chosen:** existing tables stay authoritative for their categories and are not
touched. New capabilities (`task`, `list`, `event`) and all custom types live in
a new universal `items` table. New captures of *existing* categories continue to
use the existing tables, so no record is ever stored in two places, and
`items.legacy_table/legacy_id` plus `item_relations.to_legacy_*` bridge the two
halves.

Today, Memory and Ask union the two sources **in TypeScript**, which is how
Memory already reads its six tables today. A `security_invoker` Postgres view
was considered and deferred: it would help Ask most, and Ask is Phase 6, so
building it now would mean guessing at the shape its queries need.

### 2.2 New tables (migration `20260810000005_universal_items.sql`)

```
item_types            registry. Core rows are global (user_id null);
                      custom rows are per-user. Drives categories,
                      icons, colours and field metadata.
  key, singular, plural, icon, color, kind ('core'|'custom'),
  field_schema jsonb, user_id, hidden, merged_into

items                 the universal row
  id, user_id, type_key -> item_types.key
  title, summary, status, priority, tags[]
  attributes jsonb           validated against the type's field_schema
  starts_at, ends_at, due_at, all_day, timezone, rrule
  completed_at, confidence
  source_entry_id -> inbox_entries
  legacy_table, legacy_id    bridge to the 7 existing tables

item_relations        typed, queryable edges
  from_item, to_item OR to_legacy(table,id), relation

list_items            ordered, checkable children of a list item
  list_id -> items, position, text, checked_at, quantity, unit, note
```

All four get: `user_id` FK with cascade, the four owner RLS policies, an
`updated_at` trigger, and indexes on `(user_id, due_at)`, `(user_id, type_key)`,
`(user_id, status)`, relation endpoints, and a GIN index for search.

### 2.3 Safety rails on flexible JSON

`attributes` is untrusted model output. Validated in TypeScript
(`src/lib/items/attributes.ts`) *and* by a Postgres check
(`meos_attributes_ok()`), with identical limits:

- max 32 keys, max 8 KB serialised, max 64 elements per array
- keys must match `^[a-z][a-z0-9_]{0,39}$`
- values limited to string / number / boolean / null / flat array of those
- **no nested objects at all**, so maximum depth is 2 — shallower than first
  sketched, because a depth-3 value cannot be rendered by generic field
  metadata or indexed usefully, so allowing it would only create a dumping
  ground

The TypeScript copy exists to turn a violation into a message the confirmation
UI can show; the database constraint is the one that cannot be bypassed.

The AI never issues DDL. Proposing a type inserts a row in `item_types` after
the user approves it — nothing more.

### 2.4 Extraction v2

New envelope, replacing the seven-way union as the top-level shape:

```
{ intent, needsClarification[], proposals[] }

proposal = {
  temporaryId, capability, typeKey, typeProposal?,
  title, summary,
  attributes, temporal, relations[],
  fieldConfidence, itemConfidence,
  missingFields[], ambiguities[], sourceText
}
```

`capability` is a closed set the code understands
(`task|reminder|event|list|person|document|recipe|preference|note|unsorted`).
`typeKey` is open and resolved against `item_types`.

**The LLM stops doing date arithmetic.** It returns the *phrase* it saw
(`"next Friday"`, `"tomorrow at 6"`) plus a coarse hint; `src/lib/temporal/`
resolves it deterministically against a supplied clock and IANA zone, and
returns either a resolved instant or an `ambiguity` for the user to settle.
This is what makes the temporal tests deterministic without a live API.

`note` is removed as a fallback. Unclassifiable input becomes capability
`unsorted`, which is a first-class reviewable state, not a note.

---

## 3. Migration and compatibility

1. Migration `…0005` is **additive only** — `create table`, `create index`,
   `create policy`. No `alter` or `drop` on existing objects.
2. Existing rows are untouched and keep rendering from their own screens.
3. `save_items_v2(payload jsonb)` is a **new** function; the existing
   `save_extracted_items()` stays callable so nothing breaks mid-rollout.
4. `delete_all_my_data()` is superseded by `…0006` adding the new tables — the
   old function would silently leave universal items behind, which would be a
   privacy bug.
5. Rollback: `drop` the four new tables and the two new functions. No existing
   data depends on them.

---

## 4. Implementation checklist

### Phase 1 — Audit
- [x] Read migrations, extraction layer, API routes, screens, tests
- [x] Identify root causes (§1.2, §1.3, §1.5, §1.6)
- [x] Target architecture and migration strategy (§2, §3)

### Phase 2 — Foundation
- [x] Migration `…0005_universal_items.sql` — tables, indexes, RLS, JSON guards
- [x] Migration `…0006_save_items_v2.sql` — transactional writer + updated wipe
- [x] `src/lib/items/types.ts` — core type registry, single source of truth
- [x] `src/lib/items/attributes.ts` — JSON attribute validation
- [x] Deterministic temporal resolver `src/lib/temporal/`
- [x] Tests: temporal resolution, attribute guards

### Phase 3 — Extraction
Delivered as a **vertical slice** (task + list) rather than a full rewrite, so
one usable behaviour shipped instead of three phases of scaffolding.

- [x] `task` and `list` capabilities in the Zod union and the Gemini JSON schema
- [x] Rewritten prompt — no date maths, no note fallback, secrets excluded
- [x] Deterministic normalisation: date resolution, derived titles/summaries, dedupe
- [x] `/api/analyze` returns resolved dates + `ambiguities`; `/api/save` passes the zone
- [x] Migration `…0007` — one writer, one transaction across v1 and v2 tables
- [x] Tests: shopping list, task vs note, undated task, ambiguity, dedupe
- [x] `reminder` moved onto phrase-based dates. The category the §1.3 bug hurt
      most — `remindAt` is gone from the model's schema entirely, the prompt
      forbids it, `to-rpc` fills `remind_at` from `resolvedDueAt`, and the
      editor uses the same `DueDateField` a task does, so reminders inherit the
      ambiguity question and the all-day switch for free.
      `tests/reminders.test.ts` — 9 tests, no API call
- [x] `important_date`, `document` and person birthdays moved to phrases
      (2026-08-13). The resolver gained a calendar mode:
      `resolveCalendarPhrase(phrase, ctx, direction)` returns a `YYYY-MM-DD` +
      `yearKnown` instead of an instant, and the *direction* answers "4 May,
      year unstated" per field — `memory` (birthdays, yearly dates) keeps the
      sentinel year with `yearKnown: false`, `future` (expiries, one-off
      events) rolls forward, `past` (issue dates) rolls back. An
      important_date picks its direction off `recurrence`. No ambiguity fork:
      these fields have plain date inputs, so an unplaceable phrase leaves the
      field empty with the phrase shown as provenance, and the typed date is
      the answer path. `event_date` being `not null` gained a requirement gate
      ("Pick the date this falls on."). `tests/calendar-dates.test.ts` — 20
      tests, Jerusalem-evening boundaries pinned
- ~~`capability`/`typeKey` envelope replacing the category union~~ —
      **dropped 2026-08-13, by decision.** The vertical slices delivered what
      the envelope promised: every category is phrase-based, `custom` covers
      open types, and `unsorted` never earned its place because "uncertain"
      action + low confidence already carries that state. A wholesale
      envelope rewrite now would churn every test for no behaviour
- [x] **Custom type proposal path.** The registry, the attribute guard and
      `findReusableType()` had existed since 0005 with nothing proposing, so
      the flexible half of v2 was built and unused — which is the complaint the
      whole upgrade started from. Now: a `custom` variant in the Zod union and
      the provider schema, prompt rules for when a *thing with facts* is not a
      note, and migration `…0010` adding a `custom` branch to the one writer
      that inserts the `item_types` row and the record in one transaction.
      Verified against the local DB under RLS, rolled back, then applied.
      `tests/custom-types.test.ts` — 21 tests
      - Attributes arrive as **key/value pairs**, not a free-form object: a
        structured-output schema must declare its properties, and "any keys you
        like" cannot be declared. `foldAttributes()` folds and validates them
        against the same limits `meos_attributes_ok()` enforces, dropping bad
        keys rather than losing the item they were attached to
      - Capability is always `record`. A custom type that were secretly a task
        would need a due date, a tick and a place on Today — a separate
        feature, and pretending otherwise ships a type that looks actionable
        and isn't
      - A core key always wins over a user key, so approving "recipe" reuses
        the global type instead of shadowing it
      - The proposal is matched against existing types **before** anything is
        created (§5): "Medications" lands on `medication`. Matching is on the
        normalised key *and* on the singular/plural names

### Phase 4 — UX
- [x] Actionable Today — overdue + due-today, tick-off, **user's timezone**
- [x] **Type correction on the card** (2026-08-13). Every card gains a "Kept
      as" select; `convertCategory()` in `src/lib/extraction/convert.ts`
      rebuilds the item under the target category — the name maps across,
      dates survive between dated categories (unanswered ambiguity included),
      and whatever the target requires that the source cannot supply is seeded
      blank and *blocked by name*, never invented (a task→document conversion
      asks for the document type instead of 400ing at the route). `custom` is
      not offered as a target — a type proposal cannot be invented on the
      user's behalf. Correcting away from a person clears the person match, or
      the stale id would quietly link the wrong subject.
      `tests/convert-category.test.ts` — 17 tests.
      Still not built, deliberately: a *merge* of two proposals, and a plan
      view above the cards — both wait for evidence the cards aren't enough
- [x] Ambiguity resolution UI — the question is asked on the card and gates the save
- [x] Task and list editors — fields, list rows, all-day/timed dates via
      `src/lib/temporal/inputs.ts`
- [x] Required-field validation in the sheet. `missingRequirementOf()` now
      covers all ten categories rather than alarms alone: a cleared title, an
      unnamed person, a food preference with no food, a list whose rows were all
      emptied. Each returns a sentence saying what to do next, which the card
      shows and `ConfirmationPanel` uses to disable Save — so clearing a field
      no longer reaches the route and comes back as a 400 that names nothing.
      The two date requirements (`alarmDateRequirement`, `reminderDateRequirement`)
      are exported and shared with the editors, replacing a duplicated sentence
      that was drifting. `tests/requirements.test.ts` — 27 tests
- [x] Per-field inline messages for the *non-date* fields (2026-08-13). Every
      required text field now carries `aria-invalid` and prints its sentence
      beside the input, exactly as the date fields do. One author per
      sentence: `TEXT_REQUIREMENTS` in `ambiguity.ts` feeds both the field and
      the card banner, and `missingRequirementOf()` is recomposed from the
      same map so the 27 existing tests pass untouched. The panel's incomplete
      copy stopped claiming everything is an alarm ("One card still needs
      something filled in — the note on it says what")
- [x] **Memory reads the universal layer.** It queried only the seven legacy
      tables while its own subtitle said "everything MeOS is holding for you",
      so every task, list and alarm saved since Phase 3 was missing from it —
      the same blind spot Phase 6 found in Ask, still live in this second read
      path. Both are now fixed; `/api/export` and the ICS feed were already
      reading both halves
- [x] Scalable Memory type browser. `/types` lists every type with a count,
      `/types/<key>` lists what is filed under one — the same screen serves
      core and custom types, because a custom type is a row in the same
      registry. The rail keeps its fixed set and gains one **All types** chip
      rather than growing per custom type, which is the §1.7 ceiling answered
      instead of hit. `src/lib/items/icons.ts` resolves the approved icon and
      colour names to components and chip classes — the missing half that made
      a custom type's chosen icon unusable outside the proposal card. A custom
      type with nothing filed under it is still listed, because the user
      approved it and its absence would read as a failure.
      `tests/type-icons.test.ts` — 5 tests pinning the maps against the lists
      the database enforces
- [x] Dedicated list and task screens — `/tasks` and `/lists`, reached from the
      Memory rail and owned by that tab. The section that justifies them is
      **Someday**: Today asks "due by the end of today?", so a task saved with
      no date answered no and appeared on no screen at all. Alarms sit in their
      own section on `/tasks` rather than in the due groups, because an alarm is
      not work to get through and ticking one silences it rather than finishing
      it. `src/lib/items/rows.ts` now owns the query, the row shape and the
      date wording that Today had inline — four screens read these rows, and a
      twenty-line cast copied four times is how §1.5 started.
      `tests/item-rows.test.ts` — 16 tests, day boundaries pinned either side
      of a Jerusalem evening
- [x] Copy audit pass (§1.8). `src/lib/extraction/describe.ts` names the
      *content* instead of the count — "a task, two people and a shopping
      list" — on the confirmation sheet and the save toast, using a custom
      type's own name rather than the "New type" fallback. "worth a check"
      became `uncertaintyHint()`, which says either the missing field ("no
      relationship") or that the classification itself is the doubt ("check
      it's a task"). The banned "Something went wrong" is gone from the error
      screen, replaced with the thing the user actually wants to know — that
      the failure was in showing their data, not storing it. Memory subtitles
      no longer repeat the type back where there is nothing else to say.
      `tests/describe.test.ts` — 13 tests

### Phase 5 — Calendar
- [x] Internal scheduling complete (2026-08-13). The `event` capability runs
      end-to-end: "dinner with Dana at 8" — §1.2's unrepresentable sentence —
      is now the 12th extraction category, resolved through the same phrase
      path as a task and stored as `items.starts_at` (an event is attended,
      not completed, so it never touches `due_at`). All-day events are legal
      ("conference on Friday"); an event with no *when* is blocked by name.
      Migration `…0012` adds the writer branch (re-pasting the 0010 body per
      convention), guards `starts_at` like an alarm's time, and widens the
      `item_relations` gate so a dinner links to its people through the table
      the app reads. Read side: `anchorInstant()` in `rows.ts` keys every
      screen on `due_at ?? starts_at`, and `groupByDue` gained a `past` bucket
      because a past event is *over*, not overdue. Today grows "Happening
      today" (plain rows — nothing to tick on a dinner) and future events join
      "Coming up". Verified against the local DB under RLS, rolled back, then
      applied. `tests/events.test.ts` — 13 tests.
      Deliberately not in v1: an explicit end/duration (nobody states one; the
      ICS feed's 30-minute block for timed events stands and says so) and a
      month-grid calendar screen (`/types/event` lists them; a grid waits for
      enough events to need one)
- [x] `CalendarProvider` interface + honest unconfigured state (2026-08-13).
      `src/lib/calendar/provider.ts` — an interface with one real
      implementation exists to make the *absence* of the second one honest:
      the ICS feed is `available`, Google Calendar is declared with
      `available: false` and the reason (OAuth verification, §6.2 H), and
      Settings → Calendar states it where someone would go looking.
      `tests/events.test.ts` pins the registry

### Phase 6 — Ask
- [x] Ask reads the universal layer. It queried only the seven legacy tables,
      so every task, list and alarm saved since Phase 3 was invisible and Ask
      answered "you don't have that saved" about rows on the Today screen. It
      now loads `items` + `list_items` and is told what capability and
      `checked_at` mean
- [x] `today` in the Ask context comes from the user's zone, not the server's —
      the §1.6 bug, still live in this one read path
- [x] Targeted retrieval over items + relations, with citations (2026-08-13).
      Three layers per question, one model call (free-tier quota is a named
      risk, so no plan-then-answer second call): *anchors* (people, dated
      rows, recent items — the sets any question might need), *matches*
      (deterministic term extraction in `src/lib/ask/retrieval.ts`, ILIKE
      across the question's own words — "which recipes use eggs" finds recipes
      through their ingredients), and *connections* (children plus
      `item_relations` of everything selected, both endpoints fetched — the
      first read of that table anywhere). Every record carries a `ref`; the
      model cites the refs it used, `resolveCitations()` drops anything it
      invented, and the answer bubble shows "From: Passport · Dana" chips.
      ILIKE over FTS on purpose: the legacy tables have no text indexes and
      `items`' GIN index is an expression PostgREST can't target — at personal
      scale a seq scan is microseconds, and the day that changes the fix is a
      search RPC. `tests/ask-retrieval.test.ts` — 11 tests

### Phase 7 — Verify
- [x] **Adversarial review pass, 2026-08-13.** Five independent reviewers over
      the day's five tracks, every non-nit finding re-verified by a second
      agent instructed to refute it. Nine confirmed and fixed, the two worst:
      push delivery was claimed per *alarm* rather than per *device*, so a
      two-phone user got each chime on one arbitrary phone (the
      `alarm_deliveries` key now includes the endpoint, verified live); and
      day-first dates with a comma — "22 September, 2019" — silently dropped
      the year in the new parser. Also fixed: enable-push rollback on network
      failure, the account-switch 500 on re-subscribe (RLS correctly refuses
      the takeover; possession of the endpoint is the proof, so a stale row
      is deleted with the service key scoped to that endpoint), Ask context
      truncation of term-matched rows, the relations query's 414 risk,
      Feb 29 in future/past directions, the yearly→one-off sentinel-year
      flip, and server-side named guards for `event_date`/`remind_at`.
      Two nits deliberately left: `failure_count` increments can race
      (diagnostic only), and a list reached only as a relation endpoint has
      no entries in Ask's context (a fourth query round for a corner case)
- [x] typecheck · lint · test · build · **migration against a clean DB**.
      All ten migrations apply to an empty database in order, and
      `save_extracted_items()` then writes a task, a list, an alarm, a reminder
      and a custom type in one transaction. Run in a scratch database inside
      the container rather than with `supabase db reset`, which would wipe the
      dev data (§4b). The bookkeeping drift is also fixed: 0005–0010 are now
      recorded in `supabase_migrations.schema_migrations`, so `supabase
      migration up` no longer tries to re-run 0005 and fail

### Phase 8 — Voice capture

Requested 2026-08-10. Voice is an *input method for the capture textarea*, not a
second pipeline: dictation fills the same box typing does, and the existing
analyze → confirm → save flow runs unchanged, ambiguity gate included. That is
also the safety story — a mishearing is caught at the same confirmation step a
typo is.

- [x] `useDictation()` in `src/lib/voice/dictation.ts` — final phrases are
      committed, interim words are shown and never committed, and the session
      restarts through the browser's silence timeout (bounded at 20 restarts,
      about two minutes, so a forgotten mic doesn't stay open)
- [x] Mic button in `capture-sheet.tsx`: idle / listening / denied, appending to
      whatever is already typed, `Listening…` announced once while the interim
      words stay `aria-hidden` — a live region on syllables floods a screen
      reader. Stops on close and before analyze
- [x] Feature detection via `useSyncExternalStore` with a server snapshot, so
      the button is *absent* rather than disabled where the API isn't there
      (Firefox) and the first client paint matches the HTML it hydrates
- [x] Tests: `tests/dictation.test.tsx` drives a fake recogniser — final vs
      interim, restart after silence, the restart cap, blocked microphone,
      unreachable service, release on unmount
- [x] **Verified on real hardware, 2026-08-11 (iPhone/Safari, installed PWA).**
      This was the flagged risk — that `webkitSpeechRecognition` would be
      *present but broken* inside a standalone home-screen PWA on iOS. It is
      not: the button appears, iOS prompts for the microphone, and speech lands
      in the box. Android not yet tested
- [x] **Press-and-hold as well as tap.** `src/lib/voice/press-to-talk.ts`:
      the press starts listening immediately so nothing spoken in the first
      moment is lost, a release inside 400 ms latches it on (the old toggle),
      and a longer hold stops on release. Keyboard activation never enters the
      hold path, because a press-and-hold-only control is the hardest kind for
      a tremor or a weak grip. `pointercancel` closes the microphone, and the
      synthetic click every pointer sequence fires is suppressed for 700 ms
      after a release — without that, a hold would stop and instantly restart.
      `tests/press-to-talk.test.tsx` — 10 tests against an injected clock

Rejected: recording audio and sending it to Gemini for transcription. It works
in every browser, but it costs free-tier quota per utterance, adds seconds of
latency before the user sees a word, and puts raw voice recordings on the wire —
three real costs to buy one browser.

### Phase 9 — Alarms that actually ring

"Wake me up tomorrow at 7am." Requested 2026-08-10.

`resolveDatePhrase("tomorrow at 7am")` **already returns tomorrow 07:00 local**
with `allDay: false` — `extractTime()` handles the bare `7am`. Nothing is needed
in the temporal layer. What is missing is a capability that means *ring*, and a
delivery path, because `reminders` rows are stored and displayed and never
delivered to anything.

#### 9.1 What a PWA can and cannot do — read before building

A web app **cannot be a dependable alarm clock**, and the UI must never imply it
is. Concretely:

| Constraint | Consequence |
| --- | --- |
| Web Push plays the *system notification sound*, once | No looping, no custom tone, no volume override from a push |
| iOS Web Push needs a home-screen install (16.4+) | Uninstalled Safari gets nothing at all |
| iOS respects silent mode, Focus and Do Not Disturb | Critical Alerts — the only thing that pierces DND — need an Apple entitlement that is native-app-only. **On iPhone this cannot be relied on to wake a sleeping person.** |
| Android high-urgency push wakes the device, but obeys DND | Better than iOS, still not the OS alarm clock |
| Push needs connectivity at fire time | Aeroplane mode or no signal = no ring |
| Doze / App Standby may delay delivery | Best-effort timing, not guaranteed to the second |

So the honest product is: **a nag that escalates, plus a real ring once tapped.**

- **Foreground path first** — with the app open, a client timer fires exactly on
  time and loops audio through WebAudio. No push, no server, fully reliable.
  Build this first; it is also the only path that is testable offline.
- **Push path** — `urgency: high`, short TTL, `requireInteraction: true`, a
  vibrate pattern, and a fixed `tag` so repeats replace rather than stack.
- **Escalation** — re-push every ~20s for up to 5 minutes until the client
  reports dismissal. One chime is missable; sixteen is an alarm.
- **Tapping opens `/alarm/[id]`** — full-screen, looping WebAudio tone at full
  volume, Snooze and Dismiss. This is where the actual *ringing* happens, since
  a notification cannot loop on its own.
- **The card says so.** An alarm proposal carries: "Rings through a
  notification. Phones silence those in Do Not Disturb, so keep your usual alarm
  for anything you can't miss." Same rule as the calendar's honest unconfigured
  state — the app states its limits instead of failing quietly.

#### 9.2 Build order

**Foreground path complete. Push path not started.**

- [x] `alarm` capability in extraction — "wake me", "get me up", "alarm at"
      map to it; a plain "remind me" stays a reminder
- [x] Stored as `items` with `type_key`/`capability` `'alarm'`, `due_at` = the
      instant. Migration `…0008` widens the two capability checks, seeds the
      core type, adds `snooze_alarm()` and teaches the single writer an alarm
      branch. Verified against the local DB inside a transaction and rolled
      back, then applied
- [x] Foreground ring: `/alarm/[id]`, looping WebAudio, Snooze/Dismiss, plus
      `AlarmScheduler` mounted in the app layout for alarms due while open
- [x] An alarm with no clock time is blocked in the confirmation sheet rather
      than armed at midnight — the first required-field validation in the sheet
- [x] Migration `…0011`: `push_subscriptions` (endpoint unique across the
      table — the same endpoint can never belong to two accounts) with the
      four owner RLS policies, plus `alarm_deliveries` and two
      `security definer` functions granted to `service_role` only:
      `due_alarm_pushes()` (what to send right now) and `record_alarm_push()`
      (a boolean *claim*, taken before sending, so two overlapping cron ticks
      cannot double-notify — the loser skips one chime out of fifteen).
      Verified against the local DB, rolled back, then applied
- [x] Service worker + `next-pwa`-free hand-rolled `public/sw.js`: `push`,
      `notificationclick`, focus-or-open `/alarm/[id]`, resubscribe on
      `pushsubscriptionchange`. One `tag` per alarm so the escalation
      *replaces* the previous notification instead of stacking sixteen.
      `/sw.js` and `/api/push/send` exempted in `src/proxy.ts` (tested) — the
      installer and the cron carry no session
- [x] Permission flow that explains itself before prompting (Settings →
      Alarms), and an honest state for each of: iPhone-not-installed ("Add
      MeOS to your Home Screen first — and this option appears"), denied,
      unsupported, and server-not-configured. The prompt can only ever fire
      from the explicit tap; `ServiceWorkerRegistrar` in the app layout only
      registers, never asks
- [x] `send-alarms` endpoint (`/api/push/send`) + cron. Single-tick by design:
      the endpoint answers "what is due right now" and exits — all pacing
      lives in the schedule (pg_cron `'20 seconds'`, `scripts/push-cron.sql`)
      and all idempotency in `alarm_deliveries`, so any cadence and any
      overlap is safe. Dead endpoints (404/410) are deleted on sight; soft
      failures are counted. Authenticated by `CRON_SECRET` bearer,
      hash-then-`timingSafeEqual`. TTL 60s + a per-alarm `topic`, so an
      offline phone gets the newest chime on reconnect, not a burst of history
- [x] Tests: `tests/alarms.test.ts` — capability extraction, the timeless-alarm
      gate, dedupe by time, snooze arithmetic across a DST boundary, ring/miss
      window boundaries
- [x] Tests: escalation stop conditions — `tests/push-escalation.test.ts`, 27
      tests. The arithmetic is mirrored out of the SQL into
      `src/lib/push/escalation.ts` so the window boundary, the attempt cap,
      the snooze-resets-the-nag property and the dead/transient split are
      pinned without a database
- [x] **Android hand-off to the real OS clock.** Shipped as §6.3 A — an
      `intent://…action=android.intent.action.SET_ALARM` URL on the alarm card
      and on `/alarm/[id]`, absent everywhere it cannot work. The one path that
      beats every limit in §9.1, and still an extra button rather than the
      mechanism, because it needs a tap and has no iOS equivalent

#### 9.3 Decisions worth not relitigating

**`alarm` is its own capability, not `reminder` with a different `type_key`.**
The capability column exists so behaviour is readable from the row; if both
shared one value the ring path would have to inspect `type_key`, which is the
behaviour-hidden-in-a-string problem the column was added to remove.

**Statuses were not widened for armed/snoozed/dismissed.** A snoozed alarm is
an active alarm with a later `due_at` and an `attributes.snooze_count`, so a
fourth status would be a second way to say the same thing and a second thing to
keep in sync. Dismissed is `status = 'done'` through the existing
`set_item_done()`, which already owns `completed_at`.

**`resolvedAllDay` carries a second meaning on an alarm:** "the day is known,
the time is not". `resolveDatePhrase("tomorrow")` returns tomorrow 00:00 with
`allDay: true` — the right day and the wrong time — so the sheet asks for the
time instead of arming a midnight alarm. `resolveDatePhrase("tomorrow at 7am")`
already returns 07:00 with `allDay: false` and needs nothing.

**Ringing is bounded by a one-hour grace window** (`RING_GRACE_MS`). An alarm
whose time passed while the phone was off must not ambush its owner hours
later; past the window the ring screen says it was missed and why.

**The ring screen lives outside the `(app)` route group** so it renders without
the tab bar. It repeats the layout's three-line auth redirect, which is cheaper
than a second layout.

### Phase 10 — Install on the phone (last step)

The whole point of the PWA work. Done on the real device, not an emulator.

- [x] `npm run build` clean, served over HTTPS. **Two** tunnels, not one: the
      app tunnel alone gets a login screen that cannot log in, because
      `NEXT_PUBLIC_SUPABASE_URL` is `http://127.0.0.1:54321` and the three
      browser-client callers (`login/auth-form.tsx`, `settings/account-section.tsx`,
      `alarms/alarm-scheduler.tsx`) run that request *on the phone*, where it is
      both the wrong host and blocked mixed content. Tunnel `:54321` too, point
      the variable at it and **rebuild** — `NEXT_PUBLIC_*` is inlined at build
      time. Note this publishes the local database to anyone who learns the
      hostname, using keys published in Supabase's own docs
- [x] Add to Home Screen on the actual phone, confirm standalone chrome and the
      maskable icon — **iOS done**, Android outstanding
- [ ] Grant notification permission, verify a push arrives with the app closed.
      **Blocked on §6.3 C**, which is not built: there is no service worker in
      `public/` and no VAPID or `push_subscriptions` anywhere
- [ ] **Set "wake me up tomorrow at 7am" and let it fire overnight.** Two
      different tests were conflated here. *MeOS* ringing needs C and cannot be
      run at all. The **Android hand-off (§6.3 A)** can: it puts the alarm in
      the OS Clock app, which rings through DND, a closed browser and a dead
      network. Run that one, and record it as a test of A rather than of
      Phase 9. It also happens to be the only route that works tonight
- [x] Dictate a capture on the phone — **iOS done, and it works.** The flagged
      risk (constructor present but broken in standalone) did not materialise.
      Android outstanding
- [ ] **Tap "Also set my phone's alarm" and confirm the Clock app really opens
      with 07:00 filled in.** The whole point of §6.3 A, and the only way to
      find out whether Chrome's gesture requirement is satisfied by a link tap
      inside a standalone PWA
- [ ] Share a page from Chrome into MeOS and confirm the capture sheet opens
      with the title and link in it. Needs the app installed — an uninstalled
      PWA never appears in the share sheet
- [ ] Subscribe to the ICS feed on the phone. Check a birthday recurs, an
      all-day task lands on the right day, and that revoking the link stops
      updates. Note how long the first refresh actually took
- [ ] Import two people through the contact picker and confirm a second import
      adds nothing
- [ ] Record what actually happened per platform in this file — including the
      failures, which are the useful part

#### 10.1 What the phone found — 2026-08-11

Served from a production build over two `cloudflared` quick tunnels. iPhone /
Safari only; **no Android device has been tested yet**, which leaves A, D and G
— three of the four shipped integrations — still unverified.

| | Result |
| --- | --- |
| Install to home screen (iOS) | Works. An earlier "there is no Add to Home Screen" was the *browser*, not the app — iOS only offers it in Safari and Chrome, never an in-app browser, and it sits several rows down the share sheet |
| Login through the tunnel | Works, which is what proves the two-tunnel setup |
| Dictation in standalone PWA (iOS) | **Works.** The Phase 8 unknown, closed |
| Manifest | **Was broken.** Fixed — see below |
| Everything Android | Untested |
| Tab bar spacing on iOS | Reported as looking wrong; the padding is `env(safe-area-inset-bottom)` and removing it would put tab targets under the home indicator. Unresolved — needs a look at whether the gap is filled with the bar's background or transparent |

**The bug worth the whole exercise: the manifest was behind the auth gate.**
`/manifest.webmanifest` matched the proxy's matcher — it is not under
`_next/static` and `.webmanifest` is not one of the excluded extensions — so it
307'd to `/login`. Browsers fetch a manifest with **credentials omitted** unless
the link tag carries `crossorigin="use-credentials"`, and `layout.tsx` emits a
plain `<link rel="manifest">`, so the fetch arrived anonymous even for a
signed-in user and the manifest never parsed. Consequences: no install prompt on
Android, no `display: standalone`, no maskable icon, and no share target — which
takes **D** down with it, since an uninstalled PWA never enters the share sheet.

Fixed by exempting it in `src/proxy.ts`; `tests/proxy-public-paths.test.ts`
pins the gate, including that the match is exact rather than a prefix. **A
service worker will need the same exemption when C lands** — the note is in the
comment beside `PUBLIC_FILES` so it is read at the moment it matters.

Two things this says about the method. It was found from a terminal with `curl`,
not from the phone, and on the phone it would have looked like a device problem
rather than a five-line proxy bug. And Phase 10 is listed last for good reasons,
but *serving the build over HTTPS at all* is worth doing early — it is the step
that finds this class of fault.

### Phase 11 — Integrations

Specified in **§6**. The short version: MeOS should hand jobs to the operating
system rather than reimplement them, so the next alarm work is a button that
sets a *real* Android alarm, not more of the push stack. Build order in §6.3.

- [x] A — Android OS alarm hand-off
- [x] D — Share target
- ~~F — Inbound email capture address~~ — **dropped 2026-08-13**, see §6.4
- [x] E — ICS calendar feed
- [x] C — Web Push (code-complete 2026-08-13; needs the three §"Next task"
      deployment steps, then a phone)
- [x] B — iOS Shortcuts alarm hand-off
- [x] G — Contact picker
- [ ] H / I — Google Calendar / Gmail APIs, deferred

A, D, E and G are code-complete and tested; none of the four has been used on a
real phone yet, which is Phase 10's job and where they can actually fail.

### Superseded
- [x] PWA manifest + icons — installable on phone
- ~~Web push + `pg_cron` reminder delivery~~ — absorbed into Phase 9, which
  needs the same subscription table, service worker and cron job

---

## 4b. Picking this up in a new session

Everything needed is on disk. Read this file first, then §1 for why the old
design failed — that context is not recoverable from the code alone.

### State of the local environment

| Thing | State |
| --- | --- |
| Migrations 0005–0012 | **Already applied** to the local Supabase DB, bookkeeping recorded — `supabase migration up` is clean. The **hosted** DB behind the Vercel deployment still needs 0011 and 0012 |
| Existing data | Intact — 3 people, 4 notes, 8 inbox entries |
| Dev server | Was on **:3111**; not currently running |
| VAPID keys | Generated, in `.env.local` (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`), plus a generated `CRON_SECRET`. None of the four are on Vercel yet |
| Git | The 2026-08-13 session's work (push, calendar dates, type correction, Ask retrieval, events) is uncommitted on `feat/meos-v2`; everything earlier is committed |

### Verifying SQL without touching local data

`supabase db reset` would wipe the dev data. Instead, pipe a migration plus a
test script into the container and roll back:

```bash
{ echo "begin;"; cat supabase/migrations/2026081000000X_*.sql; \
  echo "select 'OK';"; echo "rollback;"; } \
| docker exec -i supabase_db_meos psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

To test RLS, insert a row into `auth.users`, then
`set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>"}'`.

### Full check

```bash
npx tsc --noEmit && npm run lint && npm test && npm run build
```

402 tests should pass. Live-AI probes are not part of the suite — extraction
tests use fixtures in `tests/shopping-list.test.ts`, voice uses a fake
recogniser in `tests/dictation.test.tsx`, and alarms are pure arithmetic in
`tests/alarms.test.ts`. The integrations are tested the same way: the intent
URL, the shared-text fold, the ICS serialiser and the contact normaliser are
all pure functions, and none of them proves a phone did anything.

`tests/json-schema.test.ts` now reads the expected category set off the Zod
union rather than listing it, so adding a category is one edit, not two.

Component tests are jsdom-per-file (`// @vitest-environment jsdom` docblock)
and must call `afterEach(cleanup)` themselves: `globals` is off in
`vitest.config.mts`, so React Testing Library never registers its own teardown
and a second `render()` silently stacks a second copy of the tree in the DOM.
`test.env` pins `NODE_ENV=test` there too — a shell exporting `production`
otherwise loads React's production build, which has no `act()`.

### How ambiguity resolution works

`resolveDatePhrase()` returns `kind: "ambiguous"` for a phrase with two
defensible readings ("next Friday"). `normaliseProposals()` stores the question
on the proposal as `structuredData.dateAmbiguity` and leaves `resolvedDueAt`
null.

- `src/lib/extraction/ambiguity.ts` is the answer path: `dateAmbiguityOf()`
  reads the question, `applyDateChoice()` writes `resolvedDueAt` /
  `resolvedAllDay` and re-derives a list's title now the day is known.
- `EditableItem.dateChoice` holds the user's answer. `null` means the question
  is still open, `{ kind: "undated" }` is a real answer meaning "no day".
- `dateAmbiguity` deliberately survives the answer, so the card keeps showing
  the question and the choice stays changeable — same reasoning as
  `matchedPersonId` staying put when `useExistingPerson` flips.
- `ConfirmationPanel` disables Save while any *kept* item has an open question.
  Dropping the item unblocks it; an answer of "no date" unblocks it too.

The flat `ambiguities[]` array from `/api/analyze` is not what the UI reads —
each proposal carries its own question, so there is one source of truth. The
array stays because it is the tested contract of the route.

A date typed into the task/list editor also counts as an answer, so the save
button can never get stuck with no way to unstick it. The radio group tracks
`resolvedDueAt` rather than the last radio clicked, so the two never disagree.

### Two rules the editors depend on

**Never build a date with `new Date(value)`.** `<input type="date">` hands back
`"2026-08-14"`, which the Date constructor reads as *UTC* midnight — one day
earlier for everyone west of Greenwich. `src/lib/temporal/inputs.ts` is the only
sanctioned adapter, it takes an explicit zone like everything else in
`src/lib/temporal`, and `tests/temporal-inputs.test.ts` pins the behaviour
either side of the prime meridian and across a DST boundary.

**Derived copy follows the data until the user overrules it.** A list titled
"Shopping" must become "Shopping for 14 Aug" when the day is settled, and a
summary of "Milk, Bread" must gain the eggs — but a title the user typed has to
survive every later edit. `isDerivedListTitle()` / `isDerivedListSummary()`
answer "did they touch it?" by comparing against what *would* be derived, so
there is no `titleEditedByUser` flag to fall out of sync. `updateData()` in
`item-card.tsx` also checks the title didn't change in this very keystroke,
without which typing a title would fight the re-derivation character by
character.

### Next task, in priority order

0. ~~Wire push into the deployment~~ — **done 2026-08-13, from this machine.**
   All four env vars are on Vercel production (the first `CRON_SECRET` write
   picked up a stray `\r` from a PowerShell pipe and 401'd — re-added from
   bash, redeployed); migrations 0012–0013 applied to hosted via `db push`
   (hosted had received 0011 *before* the per-device fix, which is why the
   fix exists as follow-up migration 0013); the cron schedule was delivered
   as a temporary migration carrying the real URL + secret, then
   bookkeeping-reverted and deleted so no secret enters git. Verified live:
   the sender answers `{"due":0,…}` to the bearer secret, 401s without it,
   and production logs show the hosted pg_cron POSTing every 20 seconds.
1. **Phase 10, on the actual phone.** Everything about voice and alarms is
   unverified until then; a passing suite here says nothing about whether a
   push woke anybody up. New since the last device pass: enable alarms in
   Settings → Alarms on the installed PWA, set "wake me in two minutes", close
   the app, and see whether the nag arrives and escalates — plus everything
   already listed in Phase 10. Still unverified from before: the WebAudio ring
   vs iOS autoplay when opened from a notification, and all of Android.
2. **Commit the 2026-08-13 work.** Suggested split: push (C), calendar dates,
   sheet corrections, Ask retrieval, events + provider — five commits that
   mirror the five tracks, plus this doc.
3. Watch the first real extractions with the widened schema. `event` and the
   three phrase-based calendar categories change what the model is asked for;
   the fixtures pin the pipeline but only live traffic proves the prompt.
4. Deferred with reasons, for whenever evidence demands them: proposal merge
   and a plan view on the sheet; an explicit event end/duration (the ICS
   feed's 30-minute block stands and says so); a search RPC for Ask when
   personal scale stops being personal; H/I (Google APIs), unchanged.

### After v2 — agreed direction 2026-08-13, state as of 2026-08-18

**Shipped since v2 closed** (each: tested, migrated where needed, deployed):

- [x] **Feel batch** — swipe-to-complete, undo toasts over confirm dialogs,
      haptics (2026-08-16). `src/lib/swipe.ts` holds the pure gesture maths.
- [x] **Memory trio** — `belonging` ("where did I put…", parking), `loan`
      (lent/borrowed + auto come-back nudge), `size`. Seeded core types
      (0015) riding the custom path; the feature is prompt guidance.
- [x] **Recurring tasks & alarms** — "every weekday at 7";
      `src/lib/temporal/recurrence.ts` evaluates the stored dialect,
      completion *advances* `due_at` instead of finishing, DST pinned, task
      identity gained the moment (two doses ≠ one task).
- [x] **Siri capture** — tokened `/api/capture/<token>` on the feed-token
      pattern (0017); text lands as a *pending* inbox entry, reviewed through
      the ordinary gate; "Waiting for review" on Today; Settings → Capture
      carries the four Shortcut steps. §6.4's inbound-email objection does
      not apply: the token is CSPRNG possessed only by the user's Shortcut.
- [x] **Health & meds** (0018) — `medication` decomposed into bounded
      recurring tasks (rrule `UNTIL`: the course ends by itself),
      `vaccination` and `health_note` dated for "when did I last…".
- [x] **Trip brain** (0019) — `trip` with resolved start and `until`; the
      passport expiry cross-check runs at *analyze* time and surfaces as a
      non-blocking notice on the review sheet, while rebooking is cheap.
- [x] **Sheet on iOS** — rides the keyboard via visualViewport, and
      drag-to-close is real (the handle used to be decorative).
- [x] **Ask sources are doors** — citation chips navigate to the record.
- [x] **AI resilience** — one bounded retry on 5xx/network; an invalid key
      names itself (Google says 400, not 401 — it masqueraded as an outage).

**Still queued, in order:**

1. **Occasions planner.** Birthday in 3 weeks → an auto-proposed checklist
   wired to saved gift ideas. First real consumer of proactive connections.
2. **Semantic retrieval (pgvector).** Ask stops needing the word you used
   when you saved. Ask's ILIKE layer was built to be swapped for this.
3. **Person as a hub + proactive Today.** The relations exist; join them.
4. **Photo capture.** Gemini is multimodal; a poster or passport photo enters
   the same analyze → confirm pipeline.

Parked until someone actually asks: household sharing (RLS is owner-only —
an architectural decision, not a feature), a month-grid calendar, Playwright
E2E, Sentry.

**Standing verification debt:** the Phase 10 device pass — nothing above
changes it, and the overnight alarm test remains the one that matters.

---

## 5. Risks

| Risk | Mitigation |
| --- | --- |
| Two storage locations (legacy tables + `items`) drift | Union view is the only read path for Today/Memory; new captures never write both |
| Custom types proliferate into near-duplicates | Resolver matches proposals against existing types by key and singular name before creating |
| `attributes` becomes an unqueryable dumping ground | Field schema per type + GIN index + size/depth caps |
| Gemini free-tier quota under a larger schema | Extraction schema is flatter than v1's seven-way union, not deeper |
| Timezone bug persists in new code | Every date boundary goes through one helper that requires an explicit zone |
| An integration promises more than a PWA can deliver | §6.1 — hand off to the OS instead of reimplementing it, and state the limit on the surface that carries it |

---

## 6. Integrations

Added 2026-08-11, after the Phase 9 foreground path landed and raised the
obvious objection: an alarm that only rings with the app open is not an alarm.

### 6.1 The rule this section exists to enforce

**Hand the job to the operating system rather than reimplementing it in a web
app.** MeOS's advantage is that it *understands* "wake me at 7" — it does not
have to be the thing that rings. Every limit in §9.1 (Do Not Disturb, Doze,
connectivity, iOS Critical Alerts) disappears the moment a real OS alarm is
set, and none of them can be engineered around from inside a browser.

Three corollaries, applied to every row of the table below:

1. **Prefer the no-OAuth path first.** An ICS feed and an inbound email address
   deliver most of the value of the Google APIs for a fraction of the cost and
   none of the review process.
2. **A hand-off needs a user tap, and that is fine.** Chrome will not follow an
   `intent://` URL without a gesture, and it should not.
3. **State the limit where it bites.** The ring screen already says phones
   silence notifications in Do Not Disturb. Any integration that is one-way,
   delayed or platform-specific says so on the surface that uses it, not in a
   settings page nobody opens.

### 6.2 The surface

| # | Integration | Effort | What it buys | The catch |
| --- | --- | --- | --- | --- |
| A | **OS alarm hand-off (Android)** | ~0.5 d | A *real* system alarm: survives DND, airplane mode, a closed browser, a dead network | Android + Chrome only. Needs a tap. Fire-and-forget — MeOS cannot read back or cancel it |
| B | **OS alarm hand-off (iOS, Shortcuts)** | ~1 d + unknown | The only route to a real alarm on iPhone | Requires the user to install a shortcut once, by hand. Unverified — nobody has run it |
| C | **Web Push alarms** | 1–2 d | Alarms fire with the app closed | Cannot pierce Do Not Disturb on any platform. Needs connectivity at fire time. iOS needs home-screen install. The fallback, not the mechanism |
| D | **Share target** | ~0.5 d | Share text or a link from *any* app straight into MeOS capture | Android/Chrome installed PWA only. iOS ignores `share_target` |
| E | **Calendar out — ICS feed** | ~1 d | `webcal://` subscribe URL; dates, expiries and events appear in the phone's real calendar | One-way. Refresh is the client's choice: iOS roughly hourly, Google often many hours. Wrong tool for "dinner at 8 tonight" |
| F | **Mail in — inbound address** | 1–2 d | Forward any email to a private address; the body enters the existing analyze → confirm → save pipeline unchanged | Push, not pull — MeOS never reads the inbox. Needs an inbound provider (Cloudflare Email Workers, Resend, Postmark) and spoofing checks |
| G | **Contact picker** | ~0.5 d | Seed `people` from the device address book, one OS-mediated picker, no permission to hold | `navigator.contacts` is Chrome-Android-only. One-shot import, never a sync |
| H | **Calendar two-way — Google API** | 1–2 wk | Real sync, near-instant, reads existing events back | Needs Google OAuth added to auth (email/password today), offline access, sync tokens, watch channels, conflict resolution. Scopes are "sensitive": verification, no security audit |
| I | **Mail read — Gmail API** | Weeks + £ | Reads the actual inbox | `gmail.readonly` is a **restricted** scope: verification *plus* a paid annual third-party security assessment. Staying in Testing mode avoids it but expires refresh tokens every 7 days |

### 6.3 Build order, and why

- [x] **A — Android alarm hand-off.** `src/lib/alarms/os-handoff.ts` builds the
      intent URL; `OsAlarmButton` renders it on the alarm card in the
      confirmation sheet and on `/alarm/[id]`, and returns *null* — not a
      disabled control — off Chrome-Android, the same rule the mic follows.
      The clock face is read with `partsInZone`, so 07:00 in Jerusalem hands
      off as 07:00 and not as the server's 04:00. Extras are percent-encoded
      because an unescaped `;` in a title truncates the intent and silently
      drops the time
- [x] **D — Share target.** `share_target` in `src/app/manifest.ts` posting to
      `src/app/share/route.ts`, which folds title/text/url into one string and
      303s to `/?shared=…`. The tab bar picks it up, opens capture prefilled and
      strips the parameter. Nothing is stored on the way through: a share runs
      the ordinary analyze → confirm → save path, ambiguity gate included
- ~~**F — Inbound email address.**~~ **Dropped 2026-08-13, by decision.** It
      needed a domain to point MX records at, a mail provider, and SPF/DKIM
      verification before any body could be trusted — an address anyone can
      post to is an unauthenticated write path into someone's memory. That is a
      lot of surface for a capture route the share target and the capture box
      already cover. Nothing else depends on it
- [x] **E — ICS calendar feed.** `webcal://…/calendar/<token>/feed.ics`, served
      from migration `…0009`'s `calendar_feeds` table. A `VEVENT` per dated row
      across both storage halves — important dates, person birthdays, document
      expiries, reminders, and tasks/alarms/events/lists in `items` —
      with `RRULE:FREQ=YEARLY` on birthdays and anniversaries. Turned on,
      rotated and revoked from Settings → Calendar, which is also where the
      four limits are stated. `delete_all_my_data()` now revokes it first
- [ ] **C — Web Push.** After A, as the fallback for iPhones and for alarms the
      hand-off did not cover. Same subscription table, service worker and cron
      job already scoped in §9.2
- [x] **B — iOS Shortcuts hand-off.** The only route to a real alarm on an
      iPhone, because **no third-party app may create a system alarm on iOS** —
      not a web app, not a native App Store app. Apple exposes no API; only the
      built-in Clock app may. Everything else an app can do is a notification,
      which Focus and Do Not Disturb silence by design.
      `src/lib/alarms/ios-shortcut.ts` builds
      `shortcuts://run-shortcut?name=MeOS%20Alarm&input=text&text=HH:MM`, and
      `OsAlarmButton` now picks the platform's hand-off rather than being
      Android-only — one button, two mechanisms, absent where neither works.
      Settings → Alarms carries the four setup steps, because Apple offers no
      way to install a shortcut programmatically *or* to ask whether one
      exists. `tests/ios-shortcut.test.ts` — 10 tests
      - The payload is a bare `HH:MM`. A label or a date would need the user to
        add Split Text actions to a shortcut they are building by hand from
        written instructions, and every extra step is another silent failure.
        The cost — every MeOS alarm carries the shortcut's own label — is
        stated in the copy
      - The shortcut is addressed by **display name**, since Shortcuts has no
        id. `IOS_SHORTCUT_NAME` is therefore a contract with something on the
        user's phone: changing it breaks every shortcut already installed
      - iPadOS 13+ reports a *Macintosh* user agent, so the platform test reads
        `maxTouchPoints` — a Mac has no Clock app to hand an alarm to
      - **Unverified on a device.** A tap with no shortcut installed opens
        Shortcuts and does nothing, which is why the copy says what to expect
        before the tap
- [x] **G — Contact picker.** "Add from contacts" on `/people`, absent off
      Chrome-Android. Requests `name` and nothing else — numbers and emails
      have nowhere to live in `people`, and asking for data you have no use for
      is how a permission prompt stops being believable. Deduplicated against
      what is already saved on both sides of the wire, so a second import adds
      only what is new
- [ ] **H / I — Google APIs.** Deferred until something forces them. The OAuth
      and verification cost exceeds everything above it combined, and Gmail's
      restricted scope makes it the only item here that cannot be finished by
      writing code

### 6.4 Rejected

- **CalDAV against iCloud** — app-specific passwords, an undocumented dialect
  per provider, and credentials held by MeOS. The ICS feed gets most of the
  value with no credentials at all.
- **A `.ics` file with a `VALARM` as the alarm mechanism.** It does put an
  alert on the phone, but it is still an OS *notification*, so it is silenced
  by Do Not Disturb exactly like Web Push — the limit it was supposed to solve.
- **Recording audio and transcribing it server-side** — already rejected in
  Phase 8, for quota, latency and putting voice recordings on the wire.
- **Reading the inbox by IMAP with stored credentials** — holding a mail
  password is a bigger liability than the feature is worth. If inbox reading is
  ever genuinely needed, it is I, done properly, or nothing.
- **Mail *in* by forwarding address (F)** — dropped 2026-08-13. The write path
  was the problem: an address anyone can post to reaches the same analyze →
  save pipeline as the user's own typing, so every message needs SPF/DKIM
  checked before a single word of the body is trusted. Add a domain, MX
  records and a provider on top and it costs more than it returns, given the
  share target already gets arbitrary text into capture in one tap.

### 6.5 Decisions from building A, D, E and G

**The ICS feed reads through a `security definer` function, not the
service-role key.** The feed route is public and unauthenticated by
construction. Handing it a key that bypasses RLS for the whole database would
mean one forgotten `.eq("user_id", …)` leaks somebody else's calendar. Instead
`calendar_feed_events(token)` holds the privilege, and the token is its only
entry point — the route never learns a user id and cannot ask for one. The
service-role key stays where it was: account deletion, and nothing else.

**A revoked token and a token that never existed return the same 404.** Telling
a prober which of the two it found is free information about who has a feed.

**Shared text travels in the URL and is stripped on arrival.** A cookie was the
alternative and is no larger (both cap out around 4 KB), but it adds a second
mechanism and a second thing to clear. The parameter is removed with
`router.replace` the moment capture opens, and the tab bar remounts the sheet
by `key` rather than syncing a prop into state — which is also why there is no
effect there for the linter to object to.

**`share_target` is POST + multipart.** A GET target would put the shared body
in a query string the browser truncates. iOS ignores the whole block either
way; that is stated in §6.2 and is not worked around.

**The OS alarm hand-off has no date, and the copy says so.** `ACTION_SET_ALARM`
takes an hour and a minute only, so "wake me next Tuesday" hands off as 07:00,
which is tomorrow. It is also fire-and-forget: MeOS gets no id back, so
snoozing in MeOS does not snooze the phone. Both surprises land after the tap,
which is why the note sits under the button rather than in settings.

**The hand-off is offered before an alarm rings and after it was missed, never
during.** While the tone is playing there are two targets — Snooze and
Dismiss — and a third one is something to read before anything can be silenced.

**The contact picker asks for names only.** `people` has no column for a phone
number or an email, and putting them in `notes` would turn the one free-text
field into a dumping ground. Importing less also keeps the OS's own picker
dialog honest about what it is handing over.
