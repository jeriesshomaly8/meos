-- ---------------------------------------------------------------------------
-- 0018 — health memory (§v2.1: health & meds).
--
-- Three more seeded rows on the memory-trio pattern (0015): the AI proposes
-- them through the existing custom path, core-key-wins files them here, and
-- the prompt teaches the shapes. The active half of a medication — the
-- nagging — is NOT a new mechanism: the model decomposes "twice a day for 10
-- days" into recurring tasks whose rules carry UNTIL, so the course stops
-- nagging by itself and the record stays as the fact of what was taken.
--
-- Additive only. Rollback: delete the three rows.
-- ---------------------------------------------------------------------------

insert into public.item_types
  (user_id, key, singular, plural, icon, color, kind, default_capability, field_schema)
values
  -- "Amoxicillin 500mg twice a day for 10 days."
  (null, 'medication', 'Medication', 'Medications', 'pill', 'date', 'core', 'record',
   '[{"key":"dose","label":"Dose","type":"text"},{"key":"schedule","label":"How often","type":"text"},{"key":"for_what","label":"For","type":"text"},{"key":"course","label":"How long","type":"text"}]'::jsonb),
  -- "I had a tetanus shot today." — the answer to "when did I last…".
  (null, 'vaccination', 'Vaccination', 'Vaccinations', 'stethoscope', 'success', 'core', 'record',
   '[{"key":"against","label":"Against","type":"text"},{"key":"where_given","label":"Where","type":"text"}]'::jsonb),
  -- "Alfa had 38.4 fever at 19:30, gave paracetamol." — the 3am note that
  -- answers "when can I give the next dose".
  (null, 'health_note', 'Health note', 'Health notes', 'heart', 'neutral', 'core', 'record',
   '[{"key":"person","label":"Who","type":"text"},{"key":"reading","label":"Reading","type":"text"}]'::jsonb);
