-- FENN Stage 11.2 — Canon foundation (fenn_memories hardening)
-- LOCAL ONLY — do not apply until explicitly authorised.
-- Additive. Does not redesign memory_candidates or add embeddings.

-- ---------------------------------------------------------------------------
-- Visibility / future retrieval scope
-- ---------------------------------------------------------------------------
ALTER TABLE public.fenn_memories
  ADD COLUMN IF NOT EXISTS visibility text;

UPDATE public.fenn_memories
SET visibility = 'public'
WHERE visibility IS NULL;

ALTER TABLE public.fenn_memories
  ALTER COLUMN visibility SET DEFAULT 'public';

ALTER TABLE public.fenn_memories
  ALTER COLUMN visibility SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fenn_memories_visibility_check'
      AND conrelid = 'public.fenn_memories'::regclass
  ) THEN
    ALTER TABLE public.fenn_memories
      ADD CONSTRAINT fenn_memories_visibility_check
      CHECK (visibility IN ('public', 'camp', 'internal'));
  END IF;
END $$;

COMMENT ON COLUMN public.fenn_memories.visibility IS
  'Retrieval scope: public | camp | internal. Not enforced by retrieval yet (Stage 11.2).';

-- ---------------------------------------------------------------------------
-- Stable Canon source key (metadata.canon_key) — unique for layer=canon
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS fenn_memories_canon_key_uidx
  ON public.fenn_memories ((metadata ->> 'canon_key'))
  WHERE layer = 'canon'
    AND metadata ? 'canon_key'
    AND length(trim(metadata ->> 'canon_key')) > 0;

COMMENT ON INDEX public.fenn_memories_canon_key_uidx IS
  'Idempotent Canon sync identity: metadata.canon_key for layer=canon.';

-- ---------------------------------------------------------------------------
-- Browser posture: no direct fenn_memories access (trusted server only)
-- RLS already deny-by-default without policies; revoke table grants explicitly.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.fenn_memories FROM anon, authenticated;

COMMENT ON TABLE public.fenn_memories IS
  'Durable shared memory: Canon + approved Greenwood Memory. No embeddings yet. Browser roles have no direct access; trusted server only.';
