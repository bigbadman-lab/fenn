-- FENN Deeds 2.1 — optional durable link: approved submission → Wall inscription
-- LOCAL ONLY — do not apply until explicitly authorised.
--
-- Wall provenance remains source_type + source_external_id on wall_entries.
-- This column is Desk/service-role readback only (deed_submissions has no public RLS).

ALTER TABLE public.deed_submissions
  ADD COLUMN IF NOT EXISTS wall_entry_id uuid
    REFERENCES public.wall_entries (id)
    ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS deed_submissions_wall_entry_uidx
  ON public.deed_submissions (wall_entry_id)
  WHERE wall_entry_id IS NOT NULL;

COMMENT ON COLUMN public.deed_submissions.wall_entry_id IS
  'Wall inscription id when Desk deliberately shared this approved submission. Null = not shared. Writing remains via writeFennWallEntry only.';
