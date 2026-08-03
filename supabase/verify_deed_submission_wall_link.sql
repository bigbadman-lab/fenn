-- FENN Deeds 2.3 — Verification for deed_submissions.wall_entry_id
--
-- PREREQUISITE: apply
--   supabase/migrations/20260803190000_45_deed_submission_wall_link.sql
--
-- Read-only catalog checks + optional uniqueness probes.
-- Does not require X / OpenAI / chain. Does not alter production data except
-- temporary rows inside a rolled-back transaction (Part G optional).

-- ---------------------------------------------------------------------------
-- A) Column present on deed_submissions
-- ---------------------------------------------------------------------------
SELECT
  'A_COLUMN' AS section,
  c.column_name,
  c.data_type,
  c.is_nullable,
  CASE
    WHEN c.column_name IS NOT NULL AND c.data_type = 'uuid' AND c.is_nullable = 'YES'
      THEN 'OK'
    WHEN c.column_name IS NULL THEN 'MISSING'
    ELSE 'UNEXPECTED_SHAPE'
  END AS status
FROM (
  VALUES ('wall_entry_id')
) AS expected(column_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = 'deed_submissions'
 AND c.column_name = expected.column_name;

-- ---------------------------------------------------------------------------
-- B) Foreign key to wall_entries(id)
-- ---------------------------------------------------------------------------
SELECT
  'B_FOREIGN_KEY' AS section,
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name AS foreign_table,
  ccu.column_name AS foreign_column,
  rc.delete_rule,
  CASE
    WHEN ccu.table_name = 'wall_entries'
     AND ccu.column_name = 'id'
     AND kcu.column_name = 'wall_entry_id'
     AND rc.delete_rule IN ('SET NULL', 'NO ACTION', 'RESTRICT')
      THEN 'OK'
    ELSE 'FAIL'
  END AS status
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
 AND ccu.table_schema = tc.table_schema
JOIN information_schema.referential_constraints rc
  ON rc.constraint_name = tc.constraint_name
 AND rc.constraint_schema = tc.table_schema
WHERE tc.table_schema = 'public'
  AND tc.table_name = 'deed_submissions'
  AND tc.constraint_type = 'FOREIGN KEY'
  AND kcu.column_name = 'wall_entry_id';

-- ---------------------------------------------------------------------------
-- C) Partial unique index on non-null wall_entry_id
-- ---------------------------------------------------------------------------
SELECT
  'C_UNIQUE_INDEX' AS section,
  i.indexname,
  i.indexdef,
  CASE
    WHEN i.indexname = 'deed_submissions_wall_entry_uidx'
     AND i.indexdef ILIKE '%UNIQUE%'
     AND i.indexdef ILIKE '%wall_entry_id%'
     AND i.indexdef ILIKE '%WHERE%'
      THEN 'OK'
    ELSE 'MISSING_OR_UNEXPECTED'
  END AS status
FROM pg_indexes i
WHERE i.schemaname = 'public'
  AND i.tablename = 'deed_submissions'
  AND i.indexname = 'deed_submissions_wall_entry_uidx';

-- ---------------------------------------------------------------------------
-- D) Migration must not open browser write paths
-- ---------------------------------------------------------------------------
SELECT
  'D_NO_NEW_BROWSER_WRITES' AS section,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  CASE WHEN c.relrowsecurity THEN 'OK_RLS_ON' ELSE 'WARN_RLS_OFF' END AS status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('deed_submissions', 'wall_entries');

SELECT
  'D_ANON_WRITE_PRIVS' AS section,
  table_name,
  privilege_type,
  grantee,
  'UNEXPECTED_IF_PRESENT' AS status
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('deed_submissions', 'wall_entries')
  AND grantee IN ('anon', 'authenticated')
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

-- ---------------------------------------------------------------------------
-- E) Null wall_entry_id allowed many times (partial unique)
-- ---------------------------------------------------------------------------
SELECT
  'E_NULL_MULTIPLICITY' AS section,
  COUNT(*) FILTER (WHERE wall_entry_id IS NULL) AS null_links,
  COUNT(*) FILTER (WHERE wall_entry_id IS NOT NULL) AS linked,
  'OK' AS status
FROM public.deed_submissions;

-- ---------------------------------------------------------------------------
-- F) Partial unique semantics (catalog-only explanation)
-- ---------------------------------------------------------------------------
-- Expected behaviour after migration:
--   * many rows may have wall_entry_id IS NULL
--   * at most one row may reference any given wall_entries.id
-- Exercise under a transaction if you need a live probe:
--
--   BEGIN;
--   -- pick two submission ids and one wall entry id, then:
--   -- UPDATE deed_submissions SET wall_entry_id = :wall WHERE id = :a;
--   -- UPDATE deed_submissions SET wall_entry_id = :wall WHERE id = :b;  -- must fail unique
--   ROLLBACK;
--
SELECT
  'F_PARTIAL_UNIQUE_DOC' AS section,
  'duplicate non-null wall_entry_id must raise unique_violation; nulls are free' AS expectation,
  'OK' AS status;
