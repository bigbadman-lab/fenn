-- FENN Stage 11 — Master Memory + RAG verification
-- Rollback-safe probes. Does not permanently insert QA rows.
--
-- PREREQUISITES (applied in order):
--   ...06_chronicle_memory.sql
--   ...20_stage112_canon_foundation.sql
--   ...21_stage113_autonomous_memory.sql
--   ...22_stage114_memory_embeddings.sql
--   ...23_stage115_knowledge_retrieval.sql

-- ---------------------------------------------------------------------------
-- A) Core objects exist
-- ---------------------------------------------------------------------------
SELECT 'A_TABLES' AS section, t.relname,
  CASE WHEN c.oid IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM (VALUES
  ('memory_candidates'),
  ('fenn_memories'),
  ('fenn_memory_chunks')
) AS t(relname)
LEFT JOIN pg_class c ON c.relname = t.relname
LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public';

SELECT 'A_VECTOR_EXT' AS section,
  CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
    THEN 'OK' ELSE 'MISSING' END AS status;

-- ---------------------------------------------------------------------------
-- B) Browser privileges revoked on private Stage 11 tables
-- ---------------------------------------------------------------------------
SELECT 'B_BROWSER_TABLE' AS section, t.tbl, r.rolename, p.priv,
  CASE
    WHEN has_table_privilege(r.rolename, t.tbl, p.priv) THEN 'UNEXPECTED_GRANT'
    ELSE 'OK_REVOKED'
  END AS status
FROM (VALUES
  ('public.fenn_memories'),
  ('public.fenn_memory_chunks')
) AS t(tbl)
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolename)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
ORDER BY t.tbl, r.rolename, p.priv;

SELECT 'B_RLS' AS section, c.relname, c.relrowsecurity,
  CASE WHEN c.relrowsecurity THEN 'OK' ELSE 'FAIL' END AS status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('memory_candidates', 'fenn_memories', 'fenn_memory_chunks');

-- ---------------------------------------------------------------------------
-- C) Stage 11 RPC execute posture
-- ---------------------------------------------------------------------------
SELECT 'C_RPC' AS section, f.fn, r.rolename,
  CASE
    WHEN has_function_privilege(r.rolename, f.fn, 'EXECUTE') THEN 'HAS_EXECUTE'
    ELSE 'NO_EXECUTE'
  END AS status
FROM (VALUES
  ('public.resolve_memory_candidate_approve(uuid, text, text, text, text, jsonb)'),
  ('public.resolve_memory_candidate_discard(uuid, text, text, jsonb)'),
  ('public.replace_fenn_memory_chunks(uuid, text, jsonb)'),
  ('public.clear_fenn_memory_chunks(uuid)')
) AS f(fn)
CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolename);

-- search RPC signature may be vector or extensions.vector
SELECT 'C_SEARCH_RPC' AS section, r.rolename,
  CASE
    WHEN has_function_privilege(r.rolename, 'public.search_fenn_memory_chunks(extensions.vector, text, integer)', 'EXECUTE')
      OR has_function_privilege(r.rolename, 'public.search_fenn_memory_chunks(vector, text, integer)', 'EXECUTE')
    THEN 'HAS_EXECUTE'
    ELSE 'NO_EXECUTE'
  END AS status
FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolename);

-- Expect: anon/authenticated NO_EXECUTE; service_role HAS_EXECUTE

-- ---------------------------------------------------------------------------
-- D) Chunk shape
-- ---------------------------------------------------------------------------
SELECT 'D_CHUNK_UNIQUE' AS section,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'fenn_memory_chunks_memory_index_uidx'
  ) THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'D_CONTENT_TSV' AS section,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'fenn_memory_chunks'
      AND column_name = 'content_tsv'
  ) THEN 'OK' ELSE 'MISSING' END AS status;

-- ---------------------------------------------------------------------------
-- E) Scope / active / approve layer probe (rolled back)
-- ---------------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_public uuid;
  v_camp uuid;
  v_internal uuid;
  v_inactive uuid;
  v_cand uuid;
  v_profile uuid;
  v_vec text;
  v_n integer;
  v_mem uuid;
  v_layer text;
  v_vis text;
BEGIN
  SELECT '[' || string_agg('0', ',') || ']'
  INTO v_vec
  FROM generate_series(1, 1536);

  INSERT INTO public.fenn_memories (
    layer, title, content, visibility, is_active, approved_at, approved_by_actor_id, metadata
  ) VALUES
    ('canon', 'S11 Public', 'Public canon LEAF probe.', 'public', true, timezone('utc', now()), 'stage11-verify', '{}'::jsonb)
  RETURNING id INTO v_public;

  INSERT INTO public.fenn_memories (
    layer, title, content, visibility, is_active, approved_at, approved_by_actor_id, metadata
  ) VALUES
    ('greenwood_memory', 'S11 Camp', 'Camp-only memory probe.', 'camp', true, timezone('utc', now()), 'stage11-verify', '{}'::jsonb)
  RETURNING id INTO v_camp;

  INSERT INTO public.fenn_memories (
    layer, title, content, visibility, is_active, approved_at, approved_by_actor_id, metadata
  ) VALUES
    ('greenwood_memory', 'S11 Internal', 'Internal memory probe.', 'internal', true, timezone('utc', now()), 'stage11-verify', '{}'::jsonb)
  RETURNING id INTO v_internal;

  INSERT INTO public.fenn_memories (
    layer, title, content, visibility, is_active, approved_at, approved_by_actor_id, metadata
  ) VALUES
    ('canon', 'S11 Inactive', 'Inactive must not retrieve.', 'public', false, timezone('utc', now()), 'stage11-verify', '{}'::jsonb)
  RETURNING id INTO v_inactive;

  PERFORM public.replace_fenn_memory_chunks(v_public, 's11-pub', jsonb_build_array(jsonb_build_object(
    'chunk_index', 0, 'content', 'Public canon LEAF probe.', 'embedding', v_vec,
    'content_hash', 'a', 'embedding_model', 'text-embedding-3-small', 'chunking_version', 'chunk-v1'
  )));
  PERFORM public.replace_fenn_memory_chunks(v_camp, 's11-camp', jsonb_build_array(jsonb_build_object(
    'chunk_index', 0, 'content', 'Camp-only memory probe.', 'embedding', v_vec,
    'content_hash', 'b', 'embedding_model', 'text-embedding-3-small', 'chunking_version', 'chunk-v1'
  )));
  PERFORM public.replace_fenn_memory_chunks(v_internal, 's11-int', jsonb_build_array(jsonb_build_object(
    'chunk_index', 0, 'content', 'Internal memory probe.', 'embedding', v_vec,
    'content_hash', 'c', 'embedding_model', 'text-embedding-3-small', 'chunking_version', 'chunk-v1'
  )));

  INSERT INTO public.fenn_memory_chunks (
    memory_id, chunk_index, content, embedding, embedding_model,
    content_hash, source_fingerprint, chunking_version
  ) VALUES (
    v_inactive, 0, 'Inactive must not retrieve.',
    v_vec::extensions.vector(1536), 'text-embedding-3-small',
    'd', 's11-inactive', 'chunk-v1'
  );

  SELECT count(*) INTO v_n
  FROM public.search_fenn_memory_chunks(v_vec::extensions.vector(1536), 'public_agent', 50)
  WHERE memory_id IN (v_public, v_camp, v_internal, v_inactive);
  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'E_PUBLIC_AGENT_FAIL: expected 1, got %', v_n;
  END IF;

  SELECT count(*) INTO v_n
  FROM public.search_fenn_memory_chunks(v_vec::extensions.vector(1536), 'camp', 50)
  WHERE memory_id IN (v_public, v_camp, v_internal, v_inactive);
  IF v_n IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'E_CAMP_FAIL: expected 2, got %', v_n;
  END IF;

  SELECT count(*) INTO v_n
  FROM public.search_fenn_memory_chunks(v_vec::extensions.vector(1536), 'internal', 50)
  WHERE memory_id IN (v_public, v_camp, v_internal, v_inactive);
  IF v_n IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'E_INTERNAL_FAIL: expected 3, got %', v_n;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.search_fenn_memory_chunks(v_vec::extensions.vector(1536), 'internal', 50)
    WHERE memory_id = v_inactive
  ) THEN
    RAISE EXCEPTION 'E_INACTIVE_LEAK';
  END IF;

  -- Approve RPC cannot create canon/public (hardcoded greenwood_memory + camp).
  -- Requires a real profiles row because of FK — use any existing profile; rolled back.
  SELECT id INTO v_profile FROM public.profiles ORDER BY created_at ASC LIMIT 1;

  IF v_profile IS NULL THEN
    RAISE NOTICE 'E_APPROVE_SKIPPED: no profiles row available for FK';
  ELSE
    INSERT INTO public.memory_candidates (
      profile_id, character_id, camp_message_id, content, status
    ) VALUES (
      v_profile,
      NULL,
      NULL,
      'Stage 11 verify candidate content that is long enough to approve.',
      'pending'
    ) RETURNING id INTO v_cand;

    SELECT resulting_memory_id INTO v_mem
    FROM public.resolve_memory_candidate_approve(
      v_cand,
      'stage11-verify',
      'Verify Title',
      'Stage 11 verify curated durable observation content.',
      'durable_observation',
      '{}'::jsonb
    );

    IF v_mem IS NULL THEN
      RAISE EXCEPTION 'E_APPROVE_FAIL: no memory';
    END IF;

    SELECT layer, visibility INTO v_layer, v_vis
    FROM public.fenn_memories WHERE id = v_mem;

    IF v_layer IS DISTINCT FROM 'greenwood_memory' OR v_vis IS DISTINCT FROM 'camp' THEN
      RAISE EXCEPTION 'E_APPROVE_LAYER_VIS: got % / %', v_layer, v_vis;
    END IF;
  END IF;

  RAISE NOTICE 'E_PROBE_OK: scopes + approve layer/visibility locked (will rollback)';
END $$;

ROLLBACK;
