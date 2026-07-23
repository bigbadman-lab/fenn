-- FENN Stage 11.5 — Verification for scoped knowledge retrieval
--
-- PREREQUISITE: apply
--   ...22_stage114_memory_embeddings.sql
--   ...23_stage115_knowledge_retrieval.sql

-- ---------------------------------------------------------------------------
-- A) FTS column + index
-- ---------------------------------------------------------------------------
SELECT
  'A_CONTENT_TSV' AS section,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'fenn_memory_chunks'
        AND column_name = 'content_tsv'
    ) THEN 'OK'
    ELSE 'MISSING'
  END AS status;

SELECT
  'A_TSV_GIN' AS section,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'fenn_memory_chunks_content_tsv_gin'
    ) THEN 'OK'
    ELSE 'MISSING'
  END AS status;

-- ---------------------------------------------------------------------------
-- B) Search RPC privileges
-- ---------------------------------------------------------------------------
SELECT
  'B_SEARCH_RPC_EXECUTE' AS section,
  r.rolename,
  CASE
    WHEN has_function_privilege(
      r.rolename,
      'public.search_fenn_memory_chunks(extensions.vector, text, integer)',
      'EXECUTE'
    ) OR has_function_privilege(
      r.rolename,
      'public.search_fenn_memory_chunks(vector, text, integer)',
      'EXECUTE'
    ) THEN 'HAS_EXECUTE'
    ELSE 'NO_EXECUTE'
  END AS status
FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolename);

-- Expect: anon/authenticated NO_EXECUTE; service_role HAS_EXECUTE

-- ---------------------------------------------------------------------------
-- C) Chunk table still locked to browser roles
-- ---------------------------------------------------------------------------
SELECT
  'C_CHUNK_BROWSER' AS section,
  r.rolename,
  p.privilege_type,
  CASE
    WHEN has_table_privilege(r.rolename, 'public.fenn_memory_chunks', p.privilege_type)
      THEN 'UNEXPECTED_GRANT'
    ELSE 'OK_REVOKED'
  END AS status
FROM (VALUES ('anon'), ('authenticated')) AS r(rolename)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(privilege_type)
ORDER BY r.rolename, p.privilege_type;

SELECT
  'C_CHUNK_RLS' AS section,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'fenn_memory_chunks'
        AND c.relrowsecurity
    ) THEN 'OK'
    ELSE 'FAIL'
  END AS status;

-- ---------------------------------------------------------------------------
-- D) Scope / active / layer probe (rolled back)
-- ---------------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_public uuid;
  v_camp uuid;
  v_internal uuid;
  v_inactive uuid;
  v_vec text;
  v_n integer;
BEGIN
  SELECT '[' || string_agg('0', ',') || ']'
  INTO v_vec
  FROM generate_series(1, 1536);

  INSERT INTO public.fenn_memories (
    layer, title, content, visibility, is_active, approved_at, approved_by_actor_id, metadata
  ) VALUES (
    'canon', 'Stage115 Public Probe', 'Public canon probe about LEAF.', 'public', true,
    timezone('utc', now()), 'stage115-verify', '{}'::jsonb
  ) RETURNING id INTO v_public;

  INSERT INTO public.fenn_memories (
    layer, title, content, visibility, is_active, approved_at, approved_by_actor_id, metadata
  ) VALUES (
    'greenwood_memory', 'Stage115 Camp Probe', 'Camp-only probe about persistence.', 'camp', true,
    timezone('utc', now()), 'stage115-verify', '{}'::jsonb
  ) RETURNING id INTO v_camp;

  INSERT INTO public.fenn_memories (
    layer, title, content, visibility, is_active, approved_at, approved_by_actor_id, metadata
  ) VALUES (
    'greenwood_memory', 'Stage115 Internal Probe', 'Internal probe note.', 'internal', true,
    timezone('utc', now()), 'stage115-verify', '{}'::jsonb
  ) RETURNING id INTO v_internal;

  INSERT INTO public.fenn_memories (
    layer, title, content, visibility, is_active, approved_at, approved_by_actor_id, metadata
  ) VALUES (
    'canon', 'Stage115 Inactive Probe', 'Inactive should never retrieve.', 'public', false,
    timezone('utc', now()), 'stage115-verify', '{}'::jsonb
  ) RETURNING id INTO v_inactive;

  PERFORM public.replace_fenn_memory_chunks(
    v_public,
    'stage115-public-fp',
    jsonb_build_array(jsonb_build_object(
      'chunk_index', 0,
      'content', 'Public canon probe about LEAF.',
      'embedding', v_vec,
      'content_hash', 'p',
      'embedding_model', 'text-embedding-3-small',
      'chunking_version', 'chunk-v1'
    ))
  );
  PERFORM public.replace_fenn_memory_chunks(
    v_camp,
    'stage115-camp-fp',
    jsonb_build_array(jsonb_build_object(
      'chunk_index', 0,
      'content', 'Camp-only probe about persistence.',
      'embedding', v_vec,
      'content_hash', 'c',
      'embedding_model', 'text-embedding-3-small',
      'chunking_version', 'chunk-v1'
    ))
  );
  PERFORM public.replace_fenn_memory_chunks(
    v_internal,
    'stage115-internal-fp',
    jsonb_build_array(jsonb_build_object(
      'chunk_index', 0,
      'content', 'Internal probe note.',
      'embedding', v_vec,
      'content_hash', 'i',
      'embedding_model', 'text-embedding-3-small',
      'chunking_version', 'chunk-v1'
    ))
  );
  PERFORM public.replace_fenn_memory_chunks(
    v_inactive,
    'stage115-inactive-fp',
    jsonb_build_array(jsonb_build_object(
      'chunk_index', 0,
      'content', 'Inactive should never retrieve.',
      'embedding', v_vec,
      'content_hash', 'x',
      'embedding_model', 'text-embedding-3-small',
      'chunking_version', 'chunk-v1'
    ))
  );
  -- inactive parent → replace clears / does not keep usable index
  -- Force a chunk row anyway to prove search still filters is_active
  INSERT INTO public.fenn_memory_chunks (
    memory_id, chunk_index, content, embedding, embedding_model,
    content_hash, source_fingerprint, chunking_version
  ) VALUES (
    v_inactive, 0, 'Inactive should never retrieve.',
    v_vec::extensions.vector(1536), 'text-embedding-3-small',
    'x', 'stage115-inactive-fp', 'chunk-v1'
  );

  SELECT count(*) INTO v_n
  FROM public.search_fenn_memory_chunks(v_vec::extensions.vector(1536), 'public_agent', 50)
  WHERE memory_id IN (v_public, v_camp, v_internal, v_inactive);

  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'D_PUBLIC_AGENT_FAIL: expected only public active, got %', v_n;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.search_fenn_memory_chunks(v_vec::extensions.vector(1536), 'public_agent', 50)
    WHERE visibility IN ('camp', 'internal') OR memory_id = v_inactive
  ) THEN
    RAISE EXCEPTION 'D_PUBLIC_AGENT_LEAK';
  END IF;

  SELECT count(*) INTO v_n
  FROM public.search_fenn_memory_chunks(v_vec::extensions.vector(1536), 'camp', 50)
  WHERE memory_id IN (v_public, v_camp, v_internal, v_inactive);

  IF v_n IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'D_CAMP_FAIL: expected public+camp, got %', v_n;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.search_fenn_memory_chunks(v_vec::extensions.vector(1536), 'camp', 50)
    WHERE visibility = 'internal' OR memory_id = v_inactive
  ) THEN
    RAISE EXCEPTION 'D_CAMP_LEAK';
  END IF;

  SELECT count(*) INTO v_n
  FROM public.search_fenn_memory_chunks(v_vec::extensions.vector(1536), 'internal', 50)
  WHERE memory_id IN (v_public, v_camp, v_internal, v_inactive);

  IF v_n IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'D_INTERNAL_FAIL: expected 3 active scoped, got %', v_n;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.search_fenn_memory_chunks(v_vec::extensions.vector(1536), 'internal', 50)
    WHERE memory_id = v_inactive
  ) THEN
    RAISE EXCEPTION 'D_INACTIVE_LEAK';
  END IF;

  -- Confirm RPC result columns exclude provenance
  IF EXISTS (
    SELECT 1
    FROM information_schema.routines r
    JOIN information_schema.parameters p
      ON p.specific_name = r.specific_name
    WHERE r.routine_schema = 'public'
      AND r.routine_name = 'search_fenn_memory_chunks'
      AND p.parameter_mode = 'OUT'
      AND p.parameter_name IN (
        'source_candidate_id', 'source_message_id', 'source_profile_id',
        'approved_by_actor_id', 'embedding'
      )
  ) THEN
    RAISE EXCEPTION 'D_PROVENANCE_IN_RPC_OUTPUT';
  END IF;

  RAISE NOTICE 'D_PROBE_OK: scope + active filters verified (will rollback)';
END $$;

ROLLBACK;
