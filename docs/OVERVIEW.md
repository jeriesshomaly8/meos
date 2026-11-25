# MeOS — what it is and how it works

> A private personal memory system. You type one sentence in plain language;
> MeOS works out what it is, shows you what it understood, and files it where
> you'll find it again.

---

## 1. The idea

Everyone keeps the same handful of facts scattered across five apps and their
own head: a friend's birthday, a parent's allergy, when the passport expires,
that recipe from last summer, the gift idea you had in the shower.

The reason these end up scattered isn't laziness — it's **filing cost**. To
save "Mum is severely allergic to peanuts" in a normal app you first have to
decide: is that a contact note? a health record? a reminder? Then open the
right app, find the right screen, and fill in the right fields. The effort of
filing exceeds the value of the fact, so the fact never gets saved.

**MeOS removes the filing step.** You write the sentence. An LLM reads it,
decides what kind of thing it is, extracts the structured fields, and proposes
a record. You glance at it, correct anything wrong, and save.

Three principles fall out of that, and they drive most of the design:

| Principle | What it means in practice |
| --- | --- |
| **Never guess silently** | The AI proposes; the user approves. Nothing is written to the database until a human has seen it. Missing fields are shown as missing, not invented. |
| **The user doesn't know the schema** | So the UI can't require them to. Categories are filters you browse, not folders you file into. |
| **Private by default** | Row-level security on every table. The AI sees only the text you submitted, never your stored records — except in Ask, where it's your data being queried on your behalf. |

### Non-goals

- **Not a note-taking app.** Notes are one of seven categories, not the point.
- **Not a password manager.** The Secure Vault is deliberately unimplemented —
  secrets need client-side E2E encryption, and shipping a naive version that
  puts passwords in ordinary rows would be worse than shipping nothing.
- **Not medical/legal/financial advice.** Allergies are shown back as *your own
  record*, with that stated in the UI.

---

## 2. The seven things MeOS remembers

Every captured item lands in exactly one category. These are the same seven
everywhere — in the AI's output schema, in the database, and in the UI.

| Category | Example input | Stored as |
| --- | --- | --- |
| `person` | "My sister Dana loves jazz" | `people` (+ `person_preferences`) |
| `important_date` | "Our anniversary is 8 June" | `important_dates` |
| `reminder` | "Remind me to renew the car insurance in October" | `reminders` |
| `food_preference` | "Mum is severely allergic to peanuts" | `food_preferences` |
| `recipe` | *(pasted recipe text)* | `recipes` + `recipe_ingredients` |
| `document` | "Passport expires 14 May 2028" | `documents` |
| `note` | "Gift idea for Dana: vinyl records" | `notes` |

One sentence often produces **several linked items**. "Lunch with Dana
tomorrow at 1pm, she's vegetarian" yields a `person`, an `important_date` and
a `food_preference`, cross-referenced by temporary IDs before they're saved.

---

## 3. The flow

### 3.1 Capture → Confirm → Save

This is the core loop and everything else is secondary to it.

```
      ┌──────────────┐
      │  User taps + │   available on every screen, centre of the tab bar
      └──────┬───────┘
             ▼
   ╔═════════════════════╗
   ║  Capture sheet      ║   free text, up to 4000 chars
   ║  "Tell MeOS         ║
   ║   anything"         ║
   ╚══════════┬══════════╝
              │ POST /api/analyze
              ▼
   ┌─────────────────────────────────────────────┐
   │ 1. auth + rate limit (10 / 5 min)           │
   │ 2. INSERT inbox_entries (status: pending)   │◄── text is banked FIRST,
   │ 3. extractItems() → LLM → JSON              │    so an AI failure never
   │ 4. Zod validation, unparseable items dropped│    loses what you wrote
   │ 5. match names (case-insensitive) vs people │
   │ 6. UPDATE inbox_entries (status: analyzed)  │
   └────────────────────┬────────────────────────┘
                        ▼
   ╔═════════════════════════════════════════════╗
   ║  Confirmation sheet                         ║
   ║  ┌───────────────────────────────────────┐  ║
   ║  │ 👤  Dana                    [keep ●]  │  ║  collapsed by default
   ║  │     Person                            │  ║  tap to expand editor
   ║  ├───────────────────────────────────────┤  ║
   ║  │ 🍽  Dana is vegetarian       [keep ●] │  ║  toggle off to exclude
   ║  │     Food preference · worth a check   │  ║  ("worth a check" =
   ║  └───────────────────────────────────────┘  ║   model confidence < 0.8)
   ║                          [Discard] [Save 2] ║
   ╚══════════════════════┬══════════════════════╝
                          │ POST /api/save
                          ▼
   ┌─────────────────────────────────────────────┐
   │ save_extracted_items() Postgres function    │
   │ • ONE transaction — all items or none       │
   │ • user_id always taken from auth.uid()      │
   │ • resolves temp-ID links into real FKs      │
   │ • marks the inbox entry confirmed           │
   └─────────────────────────────────────────────┘
```

**Why the text is saved before the AI runs.** `inbox_entries` gets the raw text
with `processing_status: 'pending'` *before* the model is called. If the
provider is down, over quota, or returns nonsense, the row is marked `failed`
and the user's words still exist. The error copy says so explicitly — "your
text was saved."

**Why confirmation is not optional.** An LLM that files things automatically is
a system you can never fully trust, and one wrong silent write poisons the
whole database for you. Approving takes one tap; the cards are collapsed to a
one-line summary precisely so approving stays cheap.

### 3.2 Retrieval — two ways

**Browse** (`/memory`) — one list of everything, newest first, with a search
box and a filter rail. Search runs client-side over the loaded set, so it's
instant per keystroke.

**Ask** (`/ask`) — a natural-language question. The server assembles the user's
records into a JSON context, sends them with the question, and the model is
instructed to answer *only* from those records and to say "I don't have that
saved" rather than guess.

---

## 4. Screen map

Four tabs and one button. That's the entire navigation surface.

```
┌─────────────────────────────────────────────┐
│  Tuesday, 10 August                         │
│  Good evening, Jeries                       │   TODAY
│                                             │   ─────
│  COMING UP                        See all   │   one merged, chronological
│  ┌───────────────────────────────────────┐  │   list of dates + reminders
│  │ 🎂  Dana's birthday        in 3 days  │  │   + expiring documents
│  │ 🪪  Passport               in 2 months│  │
│  └───────────────────────────────────────┘  │
│                                             │
│  RECENTLY SAVED                   See all   │
│  ┌───────────────────────────────────────┐  │
│  │ 👤  Dana                      2h ago  │  │
│  └───────────────────────────────────────┘  │
├──────────┬────────┬────────┬───────────────-┤
│  Today   │ Memory │   ➕   │  Ask  │  You   │
└──────────┴────────┴────────┴───────────────-┘
```

| Tab | Route | What it holds |
| --- | --- | --- |
| **Today** | `/` | What's coming at you, plus what you saved recently. Nothing else. |
| **Memory** | `/memory` | Everything, searchable, with the category rail. |
| **➕** | *(sheet)* | Capture. Not a route — it opens over whatever you were doing. |
| **Ask** | `/ask` | Question and answer over your own records. |
| **You** | `/settings` | Profile, timezone, appearance, export, delete, sign out. |

### Categories are filters, not destinations

The category rail is pinned to the top of Memory **and** every category screen,
so switching from People to Notes is one tap in a fixed position:

```
[ All ] [ People ] [ Dates ] [ Food ] [ Recipes ] [ Docs ] [ Notes ]  →scroll
```

Each chip navigates to a real route (`/people`, `/dates`, …) because each
category screen owns behaviour a generic list can't: reminders have
completion checkboxes, notes have pinning and type filters, documents have
masked numbers, recipes have a shopping-list builder. With prefetch, it
behaves like a segmented control.

Detail screens (`/people/[id]`, `/recipes/[id]`) sit one level below and always
render a back link to their parent.

---

## 5. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Next.js 16 App Router (Turbopack)                           │
│                                                              │
│  src/proxy.ts ── auth gate + Supabase session refresh        │
│       │          public: /login /auth /privacy               │
│       ▼                                                      │
│  app/(app)/*    server components, query Supabase directly   │
│  app/api/*      analyze · save · ask · export · account      │
│  app/(app)/actions.ts   server actions (toggles, deletes)    │
└───────────────┬──────────────────────────┬───────────────────┘
                │                          │
                ▼                          ▼
     ┌────────────────────┐     ┌────────────────────────┐
     │ Supabase           │     │ AI provider            │
     │ • Postgres + RLS   │     │ • Gemini (default)     │
     │ • Auth             │     │ • OpenAI (AI_PROVIDER) │
     │ • save_extracted_  │     │   swappable behind     │
     │   items() function │     │   the AiProvider iface │
     └────────────────────┘     └────────────────────────┘
```

### Directory layout

```
src/
├─ app/
│  ├─ (app)/            authenticated screens; layout redirects if signed out
│  │  ├─ page.tsx       Today
│  │  ├─ memory/        unified browse
│  │  ├─ people|dates|food|recipes|documents|notes|vault/
│  │  ├─ ask/  settings/
│  │  └─ actions.ts     server actions
│  ├─ api/              analyze · save · ask · export · account
│  ├─ login/  auth/  privacy/
│  ├─ layout.tsx        fonts, providers
│  └─ globals.css       ← the entire design token system
├─ components/
│  ├─ kit/              the design system: list, section, sheet, screen,
│  │                    empty, category-rail
│  ├─ ui/               vendored shadcn primitives (Base UI under the hood)
│  ├─ app-shell/        tab-bar (owns the capture sheet)
│  ├─ inbox/            capture-sheet · confirmation-panel · item-card
│  └─ memory/           memory-browser
├─ lib/
│  ├─ ai/               provider abstraction — index · gemini · openai · types
│  ├─ extraction/       prompt · json-schema · schema (Zod) · extract · to-rpc
│  ├─ supabase/         server · client · config
│  └─ categories.ts     the seven categories, their icons, colours, routes
└─ proxy.ts             Next 16 middleware (the `middleware.ts` name is dead)
```

### The AI layer

`src/lib/ai/` exposes one interface, two implementations:

```ts
interface AiProvider {
  isConfigured(): boolean;
  generateJson(request: JsonRequest): Promise<unknown>;  // extraction
  generateText(request: TextRequest): Promise<string>;   // Ask
}
```

Gemini is the default because it has a genuinely free tier;
`AI_PROVIDER=openai` swaps in the paid one. Nothing above this layer knows
which is running.

Two details worth knowing before touching it:

- **Model ids get retired.** `GEMINI_MODEL` defaults to the `gemini-flash-latest`
  *alias*, not a pinned version, because Google retires pinned ids for new API
  keys and a hardcoded one takes the whole inbox down. Pin only if you need
  reproducible extraction output.
- **The JSON schema is OpenAI-shaped.** Gemini's `responseSchema` rejects
  `additionalProperties` and array-form `type: ["string","null"]`, so
  `toGeminiSchema()` translates before sending. Without it every call 400s and
  silently falls back to unstructured mode.

Errors are typed (`NOT_CONFIGURED`, `MODEL_UNAVAILABLE`, `QUOTA_EXCEEDED`,
`PROVIDER_ERROR`, `BAD_RESPONSE`) so the UI can say something true and specific
instead of "something went wrong" — the difference between "add a key",
"change the model", "you're out of quota" and "try again in a moment".

### Validation boundaries

Input is validated at every surface it crosses, never trusted and patched later:

1. **Client** — length caps and required-field checks before the request.
2. **API route** — Zod `.strict()` schemas on the request body; unknown keys rejected.
3. **Model output** — Zod again, per item. Items that don't validate are
   *dropped and counted*, and the count is shown to the user ("2 more items
   were unclear and were left out") rather than swallowed.
4. **Database** — RLS policies and `auth.uid()`; the client can't set `user_id`.

### Rate limits

In-memory, per user, per operation: analyze 10 / 5 min, save 30 / 5 min. These
protect the free AI tier more than the server. They reset on deploy — fine for
a personal app, the first thing to replace for a multi-tenant one.

---

## 6. Design language — "warm paper"

The UI is mobile-first in the strict sense: the phone layout is the design, and
the desktop layout is the same single column with more air around it. There is
no sidebar, no desktop-only information architecture, and nothing important in
a top corner where a thumb can't reach.

- **Surfaces** — warm cream paper (`--background`), pure-white cards, lit from
  directly above. Separation comes from elevation and space; cards carry no
  visible border in light mode.
- **Colour** — one terracotta accent carries every primary action. The seven
  category hues are low-chroma identifiers used in icon chips only; they never
  compete with the accent.
- **Type** — Fraunces (serif) for display sizes only; the platform UI font for
  everything read or tapped, so the app feels native rather than webby. Body
  is 17px.
- **Shape** — a single radius scale, 20px on cards.
- **Motion** — 150–250ms, ease-out, transform/opacity only, and
  `prefers-reduced-motion` cuts it all.

Every token lives in `src/app/globals.css`. Change the palette there and the
whole app follows; no component hardcodes a colour.

`src/components/kit/` is the vocabulary built on those tokens:

| Component | Role |
| --- | --- |
| `Screen` / `ScreenHeader` | Page wrapper — owns the one gutter value and the tab-bar clearance |
| `List` / `ListRow` | Grouped list — one card, many rows, inset hairlines |
| `Section` | Titled block with an optional "see all" |
| `Sheet` | Bottom sheet on phones, centred modal from `sm` up |
| `CategoryRail` | The filter chips |
| `Empty` / `EmptySearch` | Zero-data and no-match states, deliberately distinct |

---

## 7. Data model

Every user-owned table carries `user_id` and is protected by RLS.

```
profiles ──1:1── auth.users
people ──┬── person_preferences        (likes/dislikes, non-food)
         ├── food_preferences          (like · dislike · allergy · dietary)
         └── important_dates           (optional person_id)
recipes ───── recipe_ingredients
documents ─── reminders                (via related_entity_type/id)
notes
inbox_entries                          raw capture + extraction audit trail
entity_links                           cross-category relationships
```

Migrations, in order:

| File | Contents |
| --- | --- |
| `…0001_schema.sql` | Tables, enums, indexes |
| `…0002_rls.sql` | Row-level security policies |
| `…0003_save_extraction.sql` | `save_extracted_items()` — the transactional writer |
| `…0004_grants.sql` | Role grants |

`inbox_entries` is kept deliberately: it's the audit trail of what you wrote,
what the AI understood, and whether you accepted it.

---

## 8. Running it

```bash
cp .env.example .env.local     # fill in the values below
npx supabase start             # local Postgres + Auth
npx supabase db reset          # apply migrations
npm run seed                   # optional demo data
npm run dev
```

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | |
| `SUPABASE_SERVICE_ROLE_KEY` | for seed + account deletion | Server-only. Never expose to the browser. |
| `GEMINI_API_KEY` | for AI | Free key at aistudio.google.com/apikey |
| `GEMINI_MODEL` | no | Defaults to `gemini-flash-latest`. Pin only if you need reproducibility. |
| `AI_PROVIDER` / `OPENAI_API_KEY` / `OPENAI_MODEL` | no | Paid fallback |

**Without an AI key the app still works** — capture and Ask are disabled with a
message that says what to do; everything else browses and edits normally.

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint src tests scripts
npm test            # vitest
npm run build
```

---

## 9. Deliberate limitations

Known, chosen, and worth re-reading before "fixing" one of them:

- **Secure Vault is a stub.** See §1 non-goals.
- **Rate limits are in-memory.** Per-instance, reset on deploy.
- **Memory search loads up to 300 rows per table and filters client-side.**
  Right for a personal dataset, wrong for a large one. The UI says so when it
  truncates rather than silently cutting the list.
- **Voice capture is not built.** The mic affordance was removed rather than
  shipped disabled.
- **No offline mode.** Every screen is a server component reading live data.
