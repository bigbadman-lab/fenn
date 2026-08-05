-- FENN Clearing — verification (1.0A–1.0D)
--
-- PREREQUISITES (LOCAL ONLY until authorised):
--   supabase/migrations/20260805120000_47_clearing_foundation.sql
--   supabase/migrations/20260805120000_48_clearing_moderation_log.sql
--   supabase/migrations/20260805120000_49_clearing_hardening.sql
--
-- Read-only catalog checks + optional rollback-safe probes.
-- Does not touch production data.

-- ---------------------------------------------------------------------------
-- A) Tables + RLS
-- ---------------------------------------------------------------------------
SELECT
  'A_TABLE_RLS' AS section,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  CASE WHEN c.relrowsecurity THEN 'OK' ELSE 'FAIL' END AS status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'clearing_travellers',
    'clearing_messages',
    'clearing_state',
    'clearing_outlaw_moderation',
    'clearing_rate_buckets',
    'clearing_moderation_log'
  )
ORDER BY table_name;

-- ---------------------------------------------------------------------------
-- B) Singleton state
-- ---------------------------------------------------------------------------
SELECT
  'B_STATE_SINGLETON' AS section,
  count(*) AS rows,
  CASE WHEN count(*) = 1 THEN 'OK' ELSE 'FAIL' END AS status
FROM public.clearing_state
WHERE id = 1;

-- ---------------------------------------------------------------------------
-- C) RPCs present + grants (service_role execute)
-- ---------------------------------------------------------------------------
SELECT
  'C_RPC' AS section,
  p.proname AS function_name,
  CASE WHEN p.proname IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM (
  VALUES
    ('post_clearing_message'),
    ('consume_clearing_rate_bucket')
) AS expected(name)
LEFT JOIN pg_proc p
  ON p.proname = expected.name
LEFT JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public';

-- ---------------------------------------------------------------------------
-- D) No public grants on private tables
-- ---------------------------------------------------------------------------
SELECT
  'D_NO_PUBLIC_GRANTS' AS section,
  grantee,
  table_name,
  privilege_type,
  'UNEXPECTED' AS status
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'clearing_travellers',
    'clearing_messages',
    'clearing_state',
    'clearing_outlaw_moderation',
    'clearing_rate_buckets',
    'clearing_moderation_log'
  )
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

-- SELECT on messages for anon would be unexpected after 1.0A (full-row leak blocked)
SELECT
  'D_NO_ANON_MESSAGE_SELECT' AS section,
  count(*) AS grant_rows,
  CASE WHEN count(*) = 0 THEN 'OK' ELSE 'FAIL' END AS status
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'clearing_messages'
  AND grantee IN ('anon', 'authenticated')
  AND privilege_type = 'SELECT';

-- ---------------------------------------------------------------------------
-- E) Key constraints / indexes
-- ---------------------------------------------------------------------------
SELECT
  'E_CONSTRAINTS' AS section,
  expected.name,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public' AND c.conname = expected.name
    ) OR EXISTS (
      SELECT 1 FROM pg_indexes i
      WHERE i.schemaname = 'public' AND i.indexname = expected.name
    ) THEN 'OK'
    ELSE 'MISSING'
  END AS status
FROM (
  VALUES
    ('clearing_messages_author_xor'),
    ('clearing_messages_traveller_request_uidx'),
    ('clearing_messages_profile_request_uidx'),
    ('clearing_messages_feed_idx'),
    ('clearing_moderation_log_created_at_idx'),
    ('clearing_messages_traveller_accepted_status_idx')
) AS expected(name)
ORDER BY status DESC, name;

-- ---------------------------------------------------------------------------
-- F) Optional: atomic rate-limit smoke (rollback)
-- ---------------------------------------------------------------------------
BEGIN;
SELECT public.consume_clearing_rate_bucket(
  'verify:rate',
  date_trunc('hour', timezone('utc', now())),
  2
) AS hit1;
SELECT public.consume_clearing_rate_bucket(
  'verify:rate',
  date_trunc('hour', timezone('utc', now())),
  2
) AS hit2;
-- third should raise rate_limited — comment out if verify must be non-throwing
-- SELECT public.consume_clearing_rate_bucket('verify:rate', date_trunc('hour', timezone('utc', now())), 2);
ROLLBACK;

-- ---------------------------------------------------------------------------
-- G) Forbidden LEAF/Market columns on messages
-- ---------------------------------------------------------------------------
SELECT
  'G_NO_LEAF_COLUMNS' AS section,
  t.column_name,
  CASE WHEN c.column_name IS NULL THEN 'OK_ABSENT' ELSE 'UNEXPECTED' END AS status
FROM (
  VALUES ('leaf_delta'), ('reward_id'), ('market_watch_id'), ('ai_kind')
) AS t(column_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = 'clearing_messages'
 AND c.column_name = t.column_name;
