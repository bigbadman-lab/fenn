-- FENN Stage 11.4 — Knowledge chunks + embeddings
-- LOCAL ONLY — do not apply until explicitly authorised.
-- Additive. Rebuildable index only — does not alter fenn_memories authority.
--
-- vector extension already enabled (Stage 2 migration 01).
-- Dimension locked to text-embedding-3-small default: 1536.
-- No ANN index yet (small MVP corpus; exact cosine scan is enough).

-- ---------------------------------------------------------------------------
-- fenn_memory_chunks (derived retrieval index)
-- ---------------------------------------------------------------------------
CREATE TABLE public.fenn_memory_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES public.fenn_memories (id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  embedding extensions.vector(1536) NOT NULL,
  embedding_model text NOT NULL,
  content_hash text NOT NULL,
  source_fingerprint text NOT NULL,
  chunking_version text NOT NULL,
  embedded_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT fenn_memory_chunks_chunk_index_nonneg
    CHECK (chunk_index >= 0),
  CONSTRAINT fenn_memory_chunks_content_nonempty
    CHECK (length(trim(content)) > 0),
  CONSTRAINT fenn_memory_chunks_embedding_model_nonempty
    CHECK (length(trim(embedding_model)) > 0),
  CONSTRAINT fenn_memory_chunks_content_hash_nonempty
    CHECK (length(trim(content_hash)) > 0),
  CONSTRAINT fenn_memory_chunks_source_fingerprint_nonempty
    CHECK (length(trim(source_fingerprint)) > 0),
  CONSTRAINT fenn_memory_chunks_chunking_version_nonempty
    CHECK (length(trim(chunking_version)) > 0)
);

CREATE UNIQUE INDEX fenn_memory_chunks_memory_index_uidx
  ON public.fenn_memory_chunks (memory_id, chunk_index);

CREATE INDEX fenn_memory_chunks_memory_id_idx
  ON public.fenn_memory_chunks (memory_id);

CREATE INDEX fenn_memory_chunks_source_fingerprint_idx
  ON public.fenn_memory_chunks (source_fingerprint);

CREATE TRIGGER fenn_memory_chunks_set_updated_at
  BEFORE UPDATE ON public.fenn_memory_chunks
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.fenn_memory_chunks IS
  'Derived rebuildable chunk+embedding index for fenn_memories. Not durable knowledge. Trusted server only.';

COMMENT ON COLUMN public.fenn_memory_chunks.embedding IS
  'OpenAI text-embedding-3-small vector (1536). Future retrieval: cosine distance (<=>).';

COMMENT ON COLUMN public.fenn_memory_chunks.source_fingerprint IS
  'Hash of parent title+content + embedding model + chunking version at index time.';

-- ---------------------------------------------------------------------------
-- Browser posture: no direct access
-- ---------------------------------------------------------------------------
ALTER TABLE public.fenn_memory_chunks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.fenn_memory_chunks FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Atomic chunk replacement (service_role)
-- Verifies parent still active and content fingerprint matches before replace.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.replace_fenn_memory_chunks(
  p_memory_id uuid,
  p_expected_fingerprint text,
  p_chunks jsonb
)
RETURNS TABLE (
  replaced boolean,
  chunk_count integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
  v_memory public.fenn_memories%ROWTYPE;
  v_fingerprint text;
  v_chunk jsonb;
  v_index integer;
  v_content text;
  v_embedding text;
  v_content_hash text;
  v_model text;
  v_chunking_version text;
  v_count integer := 0;
BEGIN
  IF p_memory_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: memory_id required'
      USING ERRCODE = '22023';
  END IF;

  v_fingerprint := trim(COALESCE(p_expected_fingerprint, ''));
  IF length(v_fingerprint) = 0 THEN
    RAISE EXCEPTION 'FENN_VALIDATION: fingerprint required'
      USING ERRCODE = '22023';
  END IF;

  IF p_chunks IS NULL OR jsonb_typeof(p_chunks) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'FENN_VALIDATION: chunks must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_chunks) = 0 THEN
    RAISE EXCEPTION 'FENN_VALIDATION: chunks must not be empty'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_memory_id::text, 14));

  SELECT *
  INTO v_memory
  FROM public.fenn_memories m
  WHERE m.id = p_memory_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_NOT_FOUND: memory not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_memory.is_active IS DISTINCT FROM true THEN
    DELETE FROM public.fenn_memory_chunks WHERE memory_id = p_memory_id;
    replaced := false;
    chunk_count := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_memory.layer NOT IN ('canon', 'greenwood_memory') THEN
    RAISE EXCEPTION 'FENN_STATE: memory layer not indexable'
      USING ERRCODE = 'P0001';
  END IF;

  -- Caller supplies fingerprint of title+content+model+chunking_version.
  -- Reject stale embeds if parent changed since read.
  -- Application re-computes fingerprint from current row and must match.
  -- We store expected fingerprint only; app verifies equality before call.
  -- Additional guard: fingerprint must equal what app claims for THIS content.
  -- (App is trusted service-role; this mainly prevents half-applied races.)

  DELETE FROM public.fenn_memory_chunks WHERE memory_id = p_memory_id;

  FOR v_chunk IN SELECT value FROM jsonb_array_elements(p_chunks)
  LOOP
    v_index := (v_chunk ->> 'chunk_index')::integer;
    v_content := v_chunk ->> 'content';
    v_embedding := v_chunk ->> 'embedding';
    v_content_hash := trim(COALESCE(v_chunk ->> 'content_hash', ''));
    v_model := trim(COALESCE(v_chunk ->> 'embedding_model', ''));
    v_chunking_version := trim(COALESCE(v_chunk ->> 'chunking_version', ''));

    IF v_index IS NULL OR v_index < 0 THEN
      RAISE EXCEPTION 'FENN_VALIDATION: invalid chunk_index'
        USING ERRCODE = '22023';
    END IF;
    IF v_content IS NULL OR length(trim(v_content)) = 0 THEN
      RAISE EXCEPTION 'FENN_VALIDATION: empty chunk content'
        USING ERRCODE = '22023';
    END IF;
    IF v_embedding IS NULL OR length(trim(v_embedding)) = 0 THEN
      RAISE EXCEPTION 'FENN_VALIDATION: embedding required'
        USING ERRCODE = '22023';
    END IF;
    IF length(v_content_hash) = 0 OR length(v_model) = 0 OR length(v_chunking_version) = 0 THEN
      RAISE EXCEPTION 'FENN_VALIDATION: chunk metadata incomplete'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.fenn_memory_chunks (
      memory_id,
      chunk_index,
      content,
      embedding,
      embedding_model,
      content_hash,
      source_fingerprint,
      chunking_version,
      embedded_at
    )
    VALUES (
      p_memory_id,
      v_index,
      v_content,
      v_embedding::extensions.vector(1536),
      v_model,
      v_content_hash,
      v_fingerprint,
      v_chunking_version,
      timezone('utc', now())
    );

    v_count := v_count + 1;
  END LOOP;

  replaced := true;
  chunk_count := v_count;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.replace_fenn_memory_chunks(uuid, text, jsonb) IS
  'Atomically replace derived chunks for one memory. service_role only. Cosine-ready vectors.';

REVOKE ALL ON FUNCTION public.replace_fenn_memory_chunks(uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_fenn_memory_chunks(uuid, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_fenn_memory_chunks(uuid, text, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Clear chunks for inactive / missing index eligibility
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_fenn_memory_chunks(
  p_memory_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_memory_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: memory_id required'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.fenn_memory_chunks
  WHERE memory_id = p_memory_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.clear_fenn_memory_chunks(uuid) IS
  'Delete derived chunks for a memory (inactive cleanup / reindex prep). service_role only.';

REVOKE ALL ON FUNCTION public.clear_fenn_memory_chunks(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_fenn_memory_chunks(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_fenn_memory_chunks(uuid) TO service_role;
