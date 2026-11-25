# MeOS — your private personal memory system

Write anything in plain language — *"My passport expires on May 14, 2028. Remind me six months
before. Sarah's birthday is September 22 and she loves white flowers."* — and MeOS turns it into
structured, connected records: people, dates, reminders, food preferences, recipes, documents and
notes. Nothing is saved until you review and approve it.

## Stack

Next.js 16 (App Router, TypeScript, Turbopack) · Tailwind CSS 4 · shadcn/ui (Base UI) ·
Supabase (PostgreSQL + Auth + RLS) · Google Gemini structured outputs · Zod 4 ·
React Hook Form · TanStack Query · date-fns · Lucide icons · Vitest.

**Running MeOS costs nothing.** Supabase's free tier covers the database and auth, and
Gemini's free tier covers the AI. A paid OpenAI provider is available as a fallback if you
outgrow the free quota, but it is not required.

## Setup

### 1. Install

```bash
npm install --include=dev
npm run dev   # will show a "not connected" screen until step 3
```

> `--include=dev` matters if your npm config has `omit=dev` set.

### 2. Get a database

Either option creates all tables, RLS policies, and the `save_extracted_items`
transactional function.

**Option A — local, no account (needs Docker running):**

```bash
npx supabase init      # once; writes supabase/config.toml
npx supabase start     # first run pulls ~3GB of images
npx supabase db reset  # applies supabase/migrations in order
npx supabase status    # prints your local API URL + keys
```

Everything runs on your machine — no signup, works offline, and Supabase Studio is at
http://127.0.0.1:54323. Stop it with `npx supabase stop`. Email confirmation is off by
default locally, so sign-up is instant.

**Option B — hosted free tier:**

1. Create a project at [database.new](https://database.new).
2. Paste the three files in `supabase/migrations/` into the SQL editor **in filename
   order**, or run `supabase link --project-ref <your-ref> && supabase db push`.
3. (Optional) In Auth settings, disable "Confirm email" for painless development.

### 3. Environment

```bash
cp .env.example .env.local
```

Fill in:

| Variable | Where to find it | Needed for |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API | everything |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API | everything |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API (keep secret!) | seed script, delete-account |
| `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — free | AI extraction, Ask MeOS |

All AI calls run server-side; no key ever reaches the browser.

**You can skip the Gemini key at first.** Auth, all six category screens, seed data, export
and delete work without it — only the AI inbox and Ask MeOS need it, and both show a clear
message instead of failing.

### Switching AI provider

`src/lib/ai/` holds a small provider interface with two implementations. Gemini is the
default; set `AI_PROVIDER=openai` plus `OPENAI_API_KEY` to use the paid one. Adding a third
(a local Ollama model, say) means one new file implementing `AiProvider` — the Zod
validation and confirmation flow are provider-agnostic.

Gemini's free tier has a **daily request cap that Google adjusts periodically**; check your
live limits at [aistudio.google.com/rate-limit](https://aistudio.google.com/rate-limit).
Hitting it returns a friendly "you've hit today's free quota" message and your submitted
text is still saved, so nothing is lost.

### 4. Seed data (optional, dev only)

```bash
npm run seed
```

Creates `seed@meos.dev` / `meos-dev-password` with Sarah (birthday, dislikes mushrooms,
vegetarian, loves white flowers), a carbonara recipe, a passport expiring 2028 with a renewal
reminder, and two notes. Document numbers in seed data are clearly fictional.

### 5. Run

```bash
npm run dev        # http://localhost:3000
npm run typecheck  # TypeScript
npm run lint       # ESLint
npm test           # Vitest — extraction parsing, date handling, save pipeline
npm run build      # production build
```

## How the AI flow works

1. **Analyze** — `POST /api/analyze` stores the raw text as an `inbox_entries` row, sends it
   (and nothing else) to the AI provider with a strict JSON schema, validates the response with Zod
   (`src/lib/extraction/schema.ts`), and matches extracted people against existing records.
2. **Confirm** — the client renders one editable card per item: category, confidence,
   editable fields, missing-field warnings, source text, include/exclude, relationships.
   Uncertain data is flagged; unknown years are stored with a sentinel (2000) plus a
   `year_known=false` flag and never displayed.
3. **Save** — `POST /api/save` re-validates the approved items and calls the
   `save_extracted_items` Postgres function: one transaction, `SECURITY INVOKER` so RLS
   applies, `user_id` always from `auth.uid()`. Related items (a birthday and its person, a
   reminder and its document) are linked via foreign keys and `entity_links`.

## Security & privacy

- Row-level security on every table; `recipe_ingredients` is scoped through its recipe.
- The session proxy (`src/proxy.ts`) refreshes tokens and gates all app routes.
- Document numbers are masked in the UI by default and never sent to the AI provider.
- Per-user in-memory rate limiting on AI endpoints (swap for a durable store before
  scaling to multiple instances).
- Settings → export all data (JSON), delete all data, delete account (needs service key).
- No production logging of user text or extraction results.
- **No password storage** — the Secure Vault nav item is intentionally "coming soon";
  secrets need end-to-end encryption and must never be handled like ordinary AI memory
  (see `src/app/(app)/vault/page.tsx`).

## Project layout

```
supabase/migrations/   schema, RLS policies, transactional save function
scripts/seed.ts        dev seed (service-role; never run against prod)
src/proxy.ts           auth/session gate (Next 16 proxy convention)
src/lib/
  ai/                  provider interface + Gemini (default) and OpenAI implementations
  extraction/          Zod schemas, provider JSON schema, prompt, RPC payload builder
  dates.ts             sentinel-year handling, recurrence, expiry status
  supabase/            browser/server clients
src/app/
  api/                 analyze · save · ask · export · account
  (app)/               dashboard, people, dates, food, recipes, documents, notes,
                       ask, settings, vault (placeholder)
  login/, privacy/     public routes
src/components/        inbox + confirmation flow, app shell, shared UI
tests/                 extraction parsing, date handling, analyze→confirm→save pipeline
```

## Known limitations (MVP)

- Reminders are stored and displayed but not delivered (no push/email yet).
- Voice input is a placeholder.
- Dates view is an upcoming timeline grouped by month, not a full calendar grid.
- Rate limiting is per-instance in-memory.
- Record editing happens at confirmation time; saved records support delete (and
  pin/complete) but not yet full re-editing.
