-- Editorial 2.1 — expand package from 24 → 30 transmissions
-- LOCAL ONLY — apply when authorised.
-- Widens slot_index CHECK to accept indices 0..29.
-- Category values unchanged (ascii already valid for both ASCII + WILD modes).

ALTER TABLE public.editorial_transmissions
  DROP CONSTRAINT IF EXISTS editorial_transmissions_slot_index_check;

ALTER TABLE public.editorial_transmissions
  ADD CONSTRAINT editorial_transmissions_slot_index_check
    CHECK (slot_index >= 0 AND slot_index < 30);

COMMENT ON TABLE public.editorial_runs IS
  'Desk Editorial Room generation sessions. One package of 30 draft transmissions per run (Editorial 2.1).';

COMMENT ON TABLE public.editorial_transmissions IS
  'Draft transmissions for operator review. body is model draft; edited_body is operator edit. 30 slots per package. No auto-posting.';
