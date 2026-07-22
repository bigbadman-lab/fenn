-- FENN Stage 2 — Migration 01: extensions & shared helpers
-- LOCAL ONLY — do not apply until explicitly authorised.

CREATE SCHEMA IF NOT EXISTS extensions;

-- gen_random_uuid() (via pgcrypto) and future RAG support (vector).
-- No embedding columns / dimensions are created in Stage 2.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Ensure gen_random_uuid() is reachable as public.gen_random_uuid() when needed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'gen_random_uuid'
      AND n.nspname = 'public'
  ) THEN
    CREATE OR REPLACE FUNCTION public.gen_random_uuid()
    RETURNS uuid
    LANGUAGE sql
    VOLATILE
    AS $fn$
      SELECT extensions.gen_random_uuid();
    $fn$;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_updated_at() IS
  'Sets updated_at to UTC now() on row UPDATE.';

-- ---------------------------------------------------------------------------
-- EVM address shape check (lowercase hex only; no EIP-55 checksumming)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_normalized_evm_address(value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT value ~ '^0x[a-f0-9]{40}$';
$$;

COMMENT ON FUNCTION public.is_normalized_evm_address(text) IS
  'True when value matches lowercase normalized EVM address 0x + 40 hex chars.';
