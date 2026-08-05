-- Market Watch foundation verification (read-only checks + safe assertions).
-- Run as service_role / postgres in a migrated environment.
-- Does not mutate production operational data beyond SELECT assertions.

-- Tables
SELECT to_regclass('public.market_watch_config') IS NOT NULL AS config_table;
SELECT to_regclass('public.market_watch_events') IS NOT NULL AS events_table;
SELECT to_regclass('public.market_watch_cursors') IS NOT NULL AS cursors_table;
SELECT to_regclass('public.market_watch_worker_state') IS NOT NULL AS worker_state_table;

-- Singleton config exists and is disabled by default shape
SELECT
  id = 1 AS singleton_config,
  chain_id = 4663 AS chain_ok,
  enabled = false AS disabled_default,
  token_address IS NULL AS no_token_placeholder,
  pool_address IS NULL AS no_pool_placeholder
FROM public.market_watch_config
WHERE id = 1;

-- RLS enabled
SELECT c.relname, c.relrowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'market_watch_config',
    'market_watch_events',
    'market_watch_cursors',
    'market_watch_worker_state'
  )
ORDER BY c.relname;

-- No public/anon/authenticated table privileges
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name LIKE 'market_watch_%'
  AND grantee IN ('PUBLIC', 'anon', 'authenticated');
-- Expect zero rows.

-- Unique event key
SELECT conname
FROM pg_constraint
WHERE conrelid = 'public.market_watch_events'::regclass
  AND contype = 'u';

-- Indexes present
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename LIKE 'market_watch_%'
ORDER BY indexname;

-- Worker state singleton
SELECT id = 1 AS worker_singleton
FROM public.market_watch_worker_state
WHERE id = 1;

-- Lease framework still available for market_watch key
SELECT
  to_regprocedure('public.try_acquire_ops_runtime_lease(text,text,integer)') IS NOT NULL AS lease_acquire,
  to_regprocedure('public.release_ops_runtime_lease(text,text)') IS NOT NULL AS lease_release;
