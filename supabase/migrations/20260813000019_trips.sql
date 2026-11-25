-- ---------------------------------------------------------------------------
-- 0019 — trips (§v2.1: trip brain).
--
-- One seeded row on the 0015/0018 pattern. A trip is a record with a start
-- (the resolved datePhrase → due_at) and an end (`until` attribute, phrase in,
-- ISO out — normalisation resolves it the same deterministic way as any
-- date). The intelligence lives above: at analyze time the trip's end is
-- cross-checked against passport expiries, so "your passport expires five
-- months after you land" is said while booking is still cheap — that check
-- is application code, nothing here.
--
-- Additive only. Rollback: delete the row.
-- ---------------------------------------------------------------------------

insert into public.item_types
  (user_id, key, singular, plural, icon, color, kind, default_capability, field_schema)
values
  (null, 'trip', 'Trip', 'Trips', 'plane', 'accent', 'core', 'record',
   '[{"key":"destination","label":"Where","type":"text"},{"key":"until","label":"Until","type":"text"},{"key":"booked","label":"Booked with","type":"text"}]'::jsonb);
