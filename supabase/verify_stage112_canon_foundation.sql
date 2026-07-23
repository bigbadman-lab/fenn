-- FENN Stage 11.2 — Verification for Canon foundation
--
-- PREREQUISITE: apply
--   supabase/migrations/20260722180006_06_chronicle_memory.sql
--   supabase/migrations/20260722180010_10_rls.sql
--   supabase/migrations/20260723190000_20_stage112_canon_foundation.sql
--
-- Read-only catalog checks. Does not require OpenAI / embeddings / Camp traffic.

-- ---------------------------------------------------------------------------
-- A) fenn_memories present + RLS
-- ---------------------------------------------------------------------------
SELECT
  'A_TABLE_RLS' AS section,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  CASE WHEN c.relrowsecurity THEN 'OK' ELSE 'FAIL' END AS status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'fenn_memories';

-- ---------------------------------------------------------------------------
-- B) layer + visibility constraints
-- ---------------------------------------------------------------------------
SELECT
  'B_LAYER_CHECK' AS section,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public'
        AND c.conrelid = 'public.fenn_memories'::regclass
        AND c.conname = 'fenn_memories_layer_check'
        AND pg_get_constraintdef(c.oid) ILIKE '%canon%'
        AND pg_get_constraintdef(c.oid) ILIKE '%greenwood_memory%'
    ) THEN 'OK'
    ELSE 'MISSING'
  END AS status;

SELECT
  'B_VISIBILITY_CHECK' AS section,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public'
        AND c.conrelid = 'public.fenn_memories'::regclass
        AND c.conname = 'fenn_memories_visibility_check'
        AND pg_get_constraintdef(c.oid) ILIKE '%public%'
        AND pg_get_constraintdef(c.oid) ILIKE '%camp%'
        AND pg_get_constraintdef(c.oid) ILIKE '%internal%'
    ) THEN 'OK'
    ELSE 'MISSING'
  END AS status;

SELECT
  'B_VISIBILITY_COLUMN' AS section,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'fenn_memories'
        AND column_name = 'visibility'
        AND is_nullable = 'NO'
    ) THEN 'OK'
    ELSE 'MISSING'
  END AS status;

-- ---------------------------------------------------------------------------
-- C) Canon key uniqueness index
-- ---------------------------------------------------------------------------
SELECT
  'C_CANON_KEY_UIDX' AS section,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_indexes i
      WHERE i.schemaname = 'public'
        AND i.indexname = 'fenn_memories_canon_key_uidx'
        AND i.indexdef ILIKE '%UNIQUE%'
        AND i.indexdef ILIKE '%canon_key%'
    ) THEN 'OK'
    ELSE 'MISSING'
  END AS status;

-- ---------------------------------------------------------------------------
-- D) No embedding column yet
-- ---------------------------------------------------------------------------
SELECT
  'D_NO_EMBEDDING' AS section,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'fenn_memories'
        AND column_name = 'embedding'
    ) THEN 'UNEXPECTED_PRESENT'
    ELSE 'OK_ABSENT'
  END AS status;

-- ---------------------------------------------------------------------------
-- E) Browser roles cannot access fenn_memories
-- ---------------------------------------------------------------------------
SELECT
  'E_BROWSER_PRIVILEGES' AS section,
  r.rolname,
  p.privilege_type,
  CASE
    WHEN has_table_privilege(r.rolname, 'public.fenn_memories', p.privilege_type)
      THEN 'UNEXPECTED_GRANT'
    ELSE 'OK_REVOKED'
  END AS status
FROM (
  VALUES ('anon'), ('authenticated')
) AS r(rolname)
CROSS JOIN (
  VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
) AS p(privilege_type)
ORDER BY r.rolname, p.privilege_type;

-- ---------------------------------------------------------------------------
-- F) Provenance columns exist (internal only — not browser-readable)
-- ---------------------------------------------------------------------------
SELECT
  'F_PROVENANCE_COLUMNS' AS section,
  ec.column_name,
  CASE WHEN c.column_name IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM (
  VALUES
    ('source_candidate_id'),
    ('source_message_id'),
    ('source_profile_id'),
    ('approved_at'),
    ('approved_by_actor_id'),
    ('is_active'),
    ('metadata')
) AS ec(column_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = 'fenn_memories'
 AND c.column_name = ec.column_name
ORDER BY status DESC, ec.column_name;
