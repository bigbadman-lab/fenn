-- FENN Stage 10.5.1 — The Wall: wall_entries foundation
-- LOCAL ONLY — do not apply until explicitly authorised.
-- Additive. Does not modify prior migrations.
--
-- FENN speaks. Everyone else witnesses.
-- Public SELECT. Trusted service-role writes only. Append-only inscriptions.

-- ---------------------------------------------------------------------------
-- wall_entries
-- ---------------------------------------------------------------------------
CREATE TABLE public.wall_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body text NOT NULL,
  source_type text NOT NULL,
  source_external_id text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT wall_entries_body_nonempty
    CHECK (length(trim(body)) > 0),
  CONSTRAINT wall_entries_body_max_length
    CHECK (char_length(body) <= 4000),
  CONSTRAINT wall_entries_source_type_check
    CHECK (source_type IN ('bootstrap', 'system', 'x_agent')),
  CONSTRAINT wall_entries_source_external_id_nonempty
    CHECK (
      source_external_id IS NULL
      OR length(trim(source_external_id)) > 0
    ),
  CONSTRAINT wall_entries_source_external_id_max_length
    CHECK (
      source_external_id IS NULL
      OR char_length(source_external_id) <= 256
    )
);

CREATE INDEX wall_entries_created_at_idx
  ON public.wall_entries (created_at DESC);

-- Idempotency for external provenance (e.g. future Stage 12 X agent retries).
CREATE UNIQUE INDEX wall_entries_source_provenance_uidx
  ON public.wall_entries (source_type, source_external_id)
  WHERE source_external_id IS NOT NULL;

COMMENT ON TABLE public.wall_entries IS
  'The Wall — public FENN-only inscriptions. Plain-text body (incl. ASCII). Append-only.';

COMMENT ON COLUMN public.wall_entries.body IS
  'Plain text / ASCII only. Max 4000 chars. Not HTML/markdown.';

COMMENT ON COLUMN public.wall_entries.source_type IS
  'Operational provenance: bootstrap | system | x_agent. Not public product voice.';

COMMENT ON COLUMN public.wall_entries.source_external_id IS
  'Optional external event id for idempotent trusted writes. Not public.';

-- ---------------------------------------------------------------------------
-- Append-only: block UPDATE/DELETE even for privileged clients
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_wall_entries_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'wall_entries is append-only';
END;
$$;

CREATE TRIGGER wall_entries_prevent_update
  BEFORE UPDATE ON public.wall_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_wall_entries_mutation();

CREATE TRIGGER wall_entries_prevent_delete
  BEFORE DELETE ON public.wall_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_wall_entries_mutation();

-- ---------------------------------------------------------------------------
-- RLS + privilege posture (matches Stage 2 pattern for new tables)
-- ---------------------------------------------------------------------------
ALTER TABLE public.wall_entries ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.wall_entries FROM anon, authenticated;
GRANT SELECT ON public.wall_entries TO anon, authenticated;

CREATE POLICY wall_entries_public_select
  ON public.wall_entries
  FOR SELECT
  TO anon, authenticated
  USING (true);

COMMENT ON POLICY wall_entries_public_select ON public.wall_entries IS
  'Anonymous/public read of The Wall. Writes are service-role / trusted server only.';
