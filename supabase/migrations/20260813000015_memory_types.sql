-- ---------------------------------------------------------------------------
-- 0015 — three memory jobs people already do in their heads: where things
-- are, who has what, and what size everyone takes.
--
-- Not new machinery — three *seeded* rows in the same registry custom types
-- live in. The AI proposes them through the existing custom path, the
-- core-key-wins rule files them here instead of creating per-user
-- near-duplicates, and /types browses them like anything else. The entire
-- feature above this migration is prompt guidance.
--
-- Additive only. Rollback: delete the three rows (items filed under them
-- keep rendering; the type page just loses its label).
-- ---------------------------------------------------------------------------

insert into public.item_types
  (user_id, key, singular, plural, icon, color, kind, default_capability, field_schema)
values
  -- "The spare key is in the blue box on the top shelf." / "Parked on level 3."
  (null, 'belonging', 'Belonging', 'Belongings', 'map-pin', 'neutral', 'core', 'record',
   '[{"key":"location","label":"Where it is","type":"text","required":true}]'::jsonb),
  -- "I lent the drill to Yossi." — the thing, the direction, the person.
  (null, 'loan', 'Loan', 'Loans', 'package', 'warning', 'core', 'record',
   '[{"key":"direction","label":"Direction","type":"select","options":["lent","borrowed"]},{"key":"who","label":"Who","type":"text"},{"key":"until","label":"Expected back","type":"text"}]'::jsonb),
  -- "Dana''s shoe size is 38." — gold when you are standing in a shop.
  (null, 'size', 'Size', 'Sizes', 'shopping-cart', 'person', 'core', 'record',
   '[{"key":"person","label":"Whose","type":"text"},{"key":"kind","label":"Of what","type":"text"},{"key":"value","label":"Size","type":"text"}]'::jsonb);
