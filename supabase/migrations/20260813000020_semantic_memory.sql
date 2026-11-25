-- ---------------------------------------------------------------------------
-- 0020 — semantic memory (§v2.2: Ask stops needing the word you used).
--
-- pgvector embeddings on the two tables where meaning outruns wording:
-- `items` (titles, summaries, attributes) and `notes` (free prose). 768
-- dimensions = gemini-embedding-001 truncated (cosine ignores scale), on the
-- same free tier the extraction already lives on. Embeddings are written by
-- the app after save and are strictly additive — a row without one is still
-- found by the ILIKE layer, so nothing depends on a backfill.
--
-- `match_memories` is SECURITY INVOKER on purpose: RLS applies inside it,
-- so a caller can only ever measure distance to their own rows.
--
-- Additive only. Rollback: drop the function, the two columns, the extension
-- if nothing else uses it.
-- ---------------------------------------------------------------------------

create extension if not exists vector;

alter table public.items add column embedding vector(768);
alter table public.notes add column embedding vector(768);

-- HNSW over exact scan: personal scale would survive either, but the index
-- keeps Ask flat as years of memory accumulate, and costs nothing now.
create index items_embedding_idx on public.items
  using hnsw (embedding vector_cosine_ops);
create index notes_embedding_idx on public.notes
  using hnsw (embedding vector_cosine_ops);

create or replace function public.match_memories(
  query_embedding vector(768),
  match_count integer default 12
)
returns table (source text, id uuid, distance real)
language sql
stable
security invoker
set search_path = public
as $$
  select * from (
    select 'items'::text as source, i.id, (i.embedding <=> query_embedding)::real as distance
    from public.items i
    where i.embedding is not null
    union all
    select 'notes'::text, n.id, (n.embedding <=> query_embedding)::real
    from public.notes n
    where n.embedding is not null
  ) candidates
  order by distance
  limit greatest(1, least(match_count, 50));
$$;

grant execute on function public.match_memories(vector, integer) to authenticated;
