-- FENN Stage 10.5.3 — The Wall: wall_marks (Leave a Mark)
-- LOCAL ONLY — do not apply until explicitly authorised.
-- Additive. Does not modify prior migrations.
--
-- One permanent mark per registered Outlaw per Wall inscription.
-- Aggregate counts only in public DTOs — no reactor identity exposure.

CREATE TABLE public.wall_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.wall_entries (id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX wall_marks_entry_profile_uidx
  ON public.wall_marks (entry_id, profile_id);

CREATE INDEX wall_marks_entry_id_idx
  ON public.wall_marks (entry_id);

CREATE INDEX wall_marks_profile_id_idx
  ON public.wall_marks (profile_id);

COMMENT ON TABLE public.wall_marks IS
  'Wall marks — one permanent acknowledgement per profile per inscription. Not likes/comments.';

-- Append-only: no UPDATE/DELETE
CREATE OR REPLACE FUNCTION public.prevent_wall_marks_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'wall_marks is append-only';
END;
$$;

CREATE TRIGGER wall_marks_prevent_update
  BEFORE UPDATE ON public.wall_marks
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_wall_marks_mutation();

CREATE TRIGGER wall_marks_prevent_delete
  BEFORE DELETE ON public.wall_marks
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_wall_marks_mutation();

ALTER TABLE public.wall_marks ENABLE ROW LEVEL SECURITY;

-- Browser roles: no SELECT (counts via trusted server), no mutation.
REVOKE ALL ON public.wall_marks FROM anon, authenticated;

COMMENT ON FUNCTION public.prevent_wall_marks_mutation() IS
  'Append-only guard for wall_marks.';
