-- FENN Stage 11.4 — Verification for memory chunks + embeddings
--
-- PREREQUISITE: apply
--   ...01_extensions.sql (vector)
--   ...06_chronicle_memory.sql
--   ...20_stage112_canon_foundation.sql
--   ...21_stage113_autonomous_memory.sql
--   ...22_stage114_memory_embeddings.sql

-- ---------------------------------------------------------------------------
-- A) Extension + table
-- ---------------------------------------------------------------------------
SELECT
  'A_VECTOR_EXT' AS section,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_extension e
      JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = 'vector'
    ) THEN 'OK'
    ELSE 'MISSING'
  END AS status;

SELECT
  'A_TABLE_RLS' AS section,
  c.relname,
  c.relrowsecurity AS rls_enabled,
  CASE WHEN c.relrowsecurity THEN 'OK' ELSE 'FAIL' END AS status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'fenn_memory_chunks';

-- ---------------------------------------------------------------------------
-- B) Columns / constraints
-- ---------------------------------------------------------------------------
SELECT
  'B_REQUIRED_COLUMNS' AS section,
  ec.column_name,
  CASE WHEN c.column_name IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM (
  VALUES
    ('id'),
    ('memory_id'),
    ('chunk_index'),
    ('content'),
    ('embedding'),
    ('embedding_model'),
    ('content_hash'),
    ('source_fingerprint'),
    ('chunking_version'),
    ('embedded_at'),
    ('created_at'),
    ('updated_at')
) AS ec(column_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = 'fenn_memory_chunks'
 AND c.column_name = ec.column_name
ORDER BY status DESC, ec.column_name;

SELECT
  'B_UNIQUE_MEMORY_INDEX' AS section,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_indexes i
      WHERE i.schemaname = 'public'
        AND i.indexname = 'fenn_memory_chunks_memory_index_uidx'
        AND i.indexdef ILIKE '%UNIQUE%'
    ) THEN 'OK'
    ELSE 'MISSING'
  END AS status;

SELECT
  'B_FK_MEMORY' AS section,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conrelid = 'public.fenn_memory_chunks'::regclass
        AND c.contype = 'f'
        AND pg_get_constraintdef(c.oid) ILIKE '%memory_id%fenn_memories%'
        AND pg_get_constraintdef(c.oid) ILIKE '%CASCADE%'
    ) THEN 'OK'
    ELSE 'MISSING'
  END AS status;

-- ---------------------------------------------------------------------------
-- C) Embedding dimension (1536)
-- ---------------------------------------------------------------------------
SELECT
  'C_EMBEDDING_DIM' AS section,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'fenn_memory_chunks'
        AND column_name = 'embedding'
        AND udt_name = 'vector'
    ) THEN 'OK_VECTOR'
    ELSE 'MISSING'
  END AS status;

-- Probe dimension via catalog when available
SELECT
  'C_VECTOR_DIM_ATTR' AS section,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'fenn_memory_chunks'
        AND a.attname = 'embedding'
        AND NOT a.attisdropped
        AND a.atttypid = 'extensions.vector'::regtype
        AND a.atttypmod = 1536
    ) OR EXISTS (
      -- some installs encode typmod differently; accept atttypmod = 1536+4 style
      SELECT 1
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'fenn_memory_chunks'
        AND a.attname = 'embedding'
        AND NOT a.attisdropped
        AND format_type(a.atttypid, a.atttypmod) ILIKE '%vector(1536)%'
    ) THEN 'OK'
    ELSE 'CHECK_MANUALLY'
  END AS status;

-- ---------------------------------------------------------------------------
-- D) Browser privileges
-- ---------------------------------------------------------------------------
SELECT
  'D_BROWSER_PRIVILEGES' AS section,
  r.rolname,
  p.privilege_type,
  CASE
    WHEN has_table_privilege(r.rolname, 'public.fenn_memory_chunks', p.privilege_type)
      THEN 'UNEXPECTED_GRANT'
    ELSE 'OK_REVOKED'
  END AS status
FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(privilege_type)
ORDER BY r.rolname, p.privilege_type;

-- ---------------------------------------------------------------------------
-- E) RPC execute privileges
-- ---------------------------------------------------------------------------
SELECT
  'E_REPLACE_RPC' AS section,
  r.rolname,
  CASE
    WHEN has_function_privilege(
      r.rolname,
      'public.replace_fenn_memory_chunks(uuid, text, jsonb)',
      'EXECUTE'
    ) THEN 'HAS_EXECUTE'
    ELSE 'NO_EXECUTE'
  END AS status
FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname);

SELECT
  'E_CLEAR_RPC' AS section,
  r.rolname,
  CASE
    WHEN has_function_privilege(
      r.rolname,
      'public.clear_fenn_memory_chunks(uuid)',
      'EXECUTE'
    ) THEN 'HAS_EXECUTE'
    ELSE 'NO_EXECUTE'
  END AS status
FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname);

-- Expect anon/authenticated NO_EXECUTE; service_role HAS_EXECUTE

-- ---------------------------------------------------------------------------
-- F) Optional functional probe (rolled back)
-- ---------------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_memory uuid;
  v_count integer;
  v_replaced boolean;
  v_vec text;
BEGIN
  SELECT id INTO v_memory
  FROM public.fenn_memories
  WHERE is_active = true
    AND layer IN ('canon', 'greenwood_memory')
  LIMIT 1;

  IF v_memory IS NULL THEN
    RAISE NOTICE 'F_PROBE_SKIPPED: need an active fenn_memories row';
    RETURN;
  END IF;

  -- Build a zero vector of dimension 1536
  SELECT '[' || string_agg('0', ',') || ']'
  INTO v_vec
  FROM generate_series(1, 1536);

  SELECT replaced, chunk_count
  INTO v_replaced, v_count
  FROM public.replace_fenn_memory_chunks(
    v_memory,
    'stage114-verify-fingerprint',
    jsonb_build_array(
      jsonb_build_object(
        'chunk_index', 0,
        'content', 'Stage 11.4 verification chunk.',
        'embedding', v_vec,
        'content_hash', 'verify',
        'embedding_model', 'text-embedding-3-small',
        'chunking_version', 'chunk-v1'
      )
    )
  );

  IF v_replaced IS DISTINCT FROM true OR v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'F_PROBE_FAIL: replace did not write one chunk';
  END IF;

  IF (
    SELECT count(*) FROM public.fenn_memory_chunks WHERE memory_id = v_memory
  ) <> 1 THEN
    RAISE EXCEPTION 'F_PROBE_FAIL: unexpected chunk count';
  END IF;

  RAISE NOTICE 'F_PROBE_OK: vector insert + replace verified (will rollback)';
END $$;

ROLLBACK;
