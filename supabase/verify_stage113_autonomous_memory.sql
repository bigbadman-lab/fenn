-- FENN Stage 11.3 — Verification for autonomous memory review
--
-- PREREQUISITE: apply
--   ...06_chronicle_memory.sql
--   ...10_rls.sql
--   ...20_stage112_canon_foundation.sql
--   ...21_stage113_autonomous_memory.sql

-- ---------------------------------------------------------------------------
-- A) Constraints / indexes
-- ---------------------------------------------------------------------------
SELECT
  'A_CANDIDATE_STATUS' AS section,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = 'public.memory_candidates'::regclass
        AND c.conname = 'memory_candidates_status_check'
        AND pg_get_constraintdef(c.oid) ILIKE '%pending%'
        AND pg_get_constraintdef(c.oid) ILIKE '%approved%'
        AND pg_get_constraintdef(c.oid) ILIKE '%discarded%'
    ) THEN 'OK'
    ELSE 'MISSING'
  END AS status;

SELECT
  'A_MEMORY_LAYER' AS section,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = 'public.fenn_memories'::regclass
        AND c.conname = 'fenn_memories_layer_check'
    ) THEN 'OK'
    ELSE 'MISSING'
  END AS status;

SELECT
  'A_MEMORY_VISIBILITY' AS section,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = 'public.fenn_memories'::regclass
        AND c.conname = 'fenn_memories_visibility_check'
    ) THEN 'OK'
    ELSE 'MISSING'
  END AS status;

SELECT
  'A_SOURCE_CANDIDATE_UIDX' AS section,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_indexes i
      WHERE i.schemaname = 'public'
        AND i.indexname = 'fenn_memories_source_candidate_uidx'
        AND i.indexdef ILIKE '%UNIQUE%'
    ) THEN 'OK'
    ELSE 'MISSING'
  END AS status;

-- ---------------------------------------------------------------------------
-- B) RLS + browser privileges
-- ---------------------------------------------------------------------------
SELECT
  'B_RLS' AS section,
  c.relname,
  CASE WHEN c.relrowsecurity THEN 'OK' ELSE 'FAIL' END AS status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('memory_candidates', 'fenn_memories');

SELECT
  'B_BROWSER_MEMORIES' AS section,
  r.rolname,
  p.privilege_type,
  CASE
    WHEN has_table_privilege(r.rolname, 'public.fenn_memories', p.privilege_type)
      THEN 'UNEXPECTED_GRANT'
    ELSE 'OK_REVOKED'
  END AS status
FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(privilege_type)
ORDER BY r.rolname, p.privilege_type;

SELECT
  'B_BROWSER_CANDIDATES_MUTATION' AS section,
  r.rolname,
  p.privilege_type,
  CASE
    WHEN has_table_privilege(r.rolname, 'public.memory_candidates', p.privilege_type)
      THEN 'UNEXPECTED_GRANT'
    ELSE 'OK_REVOKED'
  END AS status
FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE')) AS p(privilege_type)
ORDER BY r.rolname, p.privilege_type;

-- ---------------------------------------------------------------------------
-- C) RPC execute privileges
-- ---------------------------------------------------------------------------
SELECT
  'C_APPROVE_RPC_GRANTS' AS section,
  r.rolname,
  CASE
    WHEN has_function_privilege(
      r.rolname,
      'public.resolve_memory_candidate_approve(uuid, text, text, text, text, jsonb)',
      'EXECUTE'
    ) THEN 'HAS_EXECUTE'
    ELSE 'NO_EXECUTE'
  END AS status
FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname);

SELECT
  'C_DISCARD_RPC_GRANTS' AS section,
  r.rolname,
  CASE
    WHEN has_function_privilege(
      r.rolname,
      'public.resolve_memory_candidate_discard(uuid, text, text, jsonb)',
      'EXECUTE'
    ) THEN 'HAS_EXECUTE'
    ELSE 'NO_EXECUTE'
  END AS status
FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname);

-- Expect: anon/authenticated = NO_EXECUTE, service_role = HAS_EXECUTE

-- ---------------------------------------------------------------------------
-- D) Optional functional probe (rolled back)
-- ---------------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_profile uuid;
  v_candidate uuid;
  v_memory uuid;
  v_status text;
  v_finalized boolean;
BEGIN
  SELECT id INTO v_profile FROM public.profiles LIMIT 1;
  IF v_profile IS NULL THEN
    RAISE NOTICE 'D_PROBE_SKIPPED: need a profiles row';
    RETURN;
  END IF;

  INSERT INTO public.memory_candidates (
    profile_id, character_id, camp_message_id, content, status, resulting_memory_id
  )
  VALUES (
    v_profile, NULL, NULL, 'Stage 11.3 verification probe observation.', 'pending', NULL
  )
  RETURNING id INTO v_candidate;

  SELECT finalized, status, resulting_memory_id
  INTO v_finalized, v_status, v_memory
  FROM public.resolve_memory_candidate_approve(
    v_candidate,
    'system:memory-reviewer',
    'Verification probe',
    'An idea offered at Camp used only for verification.',
    'durable_observation',
    '{"auto_reviewed": true}'::jsonb
  );

  IF v_status IS DISTINCT FROM 'approved' OR v_memory IS NULL THEN
    RAISE EXCEPTION 'D_PROBE_FAIL: approve did not produce memory';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.fenn_memories
    WHERE id = v_memory
      AND (layer IS DISTINCT FROM 'greenwood_memory' OR visibility IS DISTINCT FROM 'camp')
  ) THEN
    RAISE EXCEPTION 'D_PROBE_FAIL: memory layer/visibility incorrect';
  END IF;

  -- Second approve should be idempotent (finalized=false).
  SELECT finalized INTO v_finalized
  FROM public.resolve_memory_candidate_approve(
    v_candidate,
    'system:memory-reviewer',
    'Verification probe',
    'An idea offered at Camp used only for verification.',
    'durable_observation',
    '{}'::jsonb
  );

  IF v_finalized IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'D_PROBE_FAIL: second approve should be idempotent';
  END IF;

  IF (
    SELECT count(*) FROM public.fenn_memories WHERE source_candidate_id = v_candidate
  ) <> 1 THEN
    RAISE EXCEPTION 'D_PROBE_FAIL: duplicate memories for one candidate';
  END IF;

  RAISE NOTICE 'D_PROBE_OK: approve + idempotency verified (will rollback)';
END $$;

ROLLBACK;
