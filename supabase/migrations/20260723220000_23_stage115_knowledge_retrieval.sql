-- FENN Stage 11.5 — Scoped knowledge retrieval
-- LOCAL ONLY — do not apply until explicitly authorised.
-- Additive. Does not alter fenn_memories authority or chunk embeddings.
--
-- Exact cosine scan (no ANN). Scope → visibility allowlist enforced in SQL.
-- FTS uses `simple` (no stemming) to preserve FENN vocabulary (LEAF, FENN, …).

-- ---------------------------------------------------------------------------
-- Lexical: generated tsvector on chunk content (simple config)
-- ---------------------------------------------------------------------------
ALTER TABLE public.fenn_memory_chunks
  ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS fenn_memory_chunks_content_tsv_gin
  ON public.fenn_memory_chunks
  USING GIN (content_tsv);

COMMENT ON COLUMN public.fenn_memory_chunks.content_tsv IS
  'Stage 11.5 lexical support. to_tsvector(simple) — no English stemming; FENN terms stay exact.';

-- ---------------------------------------------------------------------------
-- public.search_fenn_memory_chunks
-- Semantic candidate selection with active + layer + scope filters in SQL.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_fenn_memory_chunks(
  p_query_embedding extensions.vector(1536),
  p_scope text,
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  memory_id uuid,
  chunk_index integer,
  content text,
  title text,
  layer text,
  visibility text,
  cosine_distance double precision
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
  v_scope text;
  v_limit integer;
BEGIN
  IF p_query_embedding IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: query embedding required'
      USING ERRCODE = '22023';
  END IF;

  v_scope := trim(COALESCE(p_scope, ''));
  IF v_scope NOT IN ('public_agent', 'camp', 'internal') THEN
    RAISE EXCEPTION 'FENN_VALIDATION: invalid retrieval scope'
      USING ERRCODE = '22023';
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 20), 50));

  RETURN QUERY
  SELECT
    c.memory_id,
    c.chunk_index,
    c.content,
    m.title,
    m.layer,
    m.visibility,
    (c.embedding <=> p_query_embedding)::double precision AS cosine_distance
  FROM public.fenn_memory_chunks c
  INNER JOIN public.fenn_memories m
    ON m.id = c.memory_id
  WHERE m.is_active = true
    AND m.layer IN ('canon', 'greenwood_memory')
    AND (
      (v_scope = 'public_agent' AND m.visibility = 'public')
      OR (v_scope = 'camp' AND m.visibility IN ('public', 'camp'))
      OR (v_scope = 'internal' AND m.visibility IN ('public', 'camp', 'internal'))
    )
  ORDER BY c.embedding <=> p_query_embedding ASC
  LIMIT v_limit;
END;
$$;

COMMENT ON FUNCTION public.search_fenn_memory_chunks(extensions.vector, text, integer) IS
  'Stage 11.5 private semantic candidate search. Scope maps to visibility in SQL. service_role only. No provenance/vectors returned.';

REVOKE ALL ON FUNCTION public.search_fenn_memory_chunks(extensions.vector, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_fenn_memory_chunks(extensions.vector, text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_fenn_memory_chunks(extensions.vector, text, integer) TO service_role;
