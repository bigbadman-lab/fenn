-- Market Watch foundation verification (1.0D)
-- Read-only checks + safe assertions. No irreversible deletes.
-- Run as service_role / postgres after migration 50.

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

-- Status / pool constraints (must allow reorged)
SELECT pg_get_constraintdef(oid) AS events_checks
FROM pg_constraint
WHERE conrelid = 'public.market_watch_events'::regclass
  AND contype = 'c'
ORDER BY conname;

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

-- No public/anon/authenticated table privileges (expect zero rows)
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name LIKE 'market_watch_%'
  AND grantee IN ('PUBLIC', 'anon', 'authenticated');

-- Unique event identity
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.market_watch_events'::regclass
  AND contype = 'u';

-- Cursor source_key uniqueness
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.market_watch_cursors'::regclass
  AND contype IN ('u', 'p');

-- Indexes used by Clearing/Desk
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename LIKE 'market_watch_%'
ORDER BY indexname;

-- Worker state singleton
SELECT id = 1 AS worker_singleton
FROM public.market_watch_worker_state
WHERE id = 1;

-- Lease framework for market_watch key
SELECT
  to_regprocedure('public.try_acquire_ops_runtime_lease(text,text,integer)') IS NOT NULL AS lease_acquire,
  to_regprocedure('public.release_ops_runtime_lease(text,text)') IS NOT NULL AS lease_release;

-- Reorg status support check (count only)
SELECT COUNT(*) FILTER (WHERE status = 'reorged') AS reorged_rows
FROM public.market_watch_events;

-- ---------------------------------------------------------------------------
-- Safe sample transaction (rollback) — service-role insert/update smoke
-- Only run interactively if desired; ends with ROLLBACK.
-- ---------------------------------------------------------------------------
BEGIN;
  -- Does not commit — validates insert/update/unique path on a disposable row.
  INSERT INTO public.market_watch_events (
    chain_id, event_type, token_address, pool_address, quote_token_address,
    transaction_hash, log_index, block_number,
    fenn_amount_raw, quote_amount_raw, classification_version, status
  ) VALUES (
    4663, 'acquisition',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '0xcccccccccccccccccccccccccccccccccccccccc',
    '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    999001,
    1,
    1, 1, 'mw_verify_tx', 'published'
  );

  UPDATE public.market_watch_events
  SET status = 'reorged', published_at = NULL, reorged_at = now()
  WHERE transaction_hash = '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    AND log_index = 999001;

  -- Unique conflict should fail if re-inserted:
  -- INSERT ... (same identity) -- expect error outside this template.

ROLLBACK;
