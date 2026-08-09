-- FENN — Verify treasury_assets NULL-contract uniqueness (read-only checks + optional write probe)
--
-- PREREQUISITE: migrations through 20260809210000_62_treasury_assets_null_contract_uidx.sql
-- Run in a transaction and ROLLBACK for write probes (D).

-- ---------------------------------------------------------------------------
-- A) Contract uniqueness index is partial (non-null only)
-- ---------------------------------------------------------------------------
SELECT
  'A_CHAIN_CONTRACT_UIDX' AS section,
  i.relname AS index_name,
  ix.indisunique AS is_unique,
  pg_get_expr(ix.indpred, ix.indrelid) AS predicate,
  indexdef,
  CASE
    WHEN ix.indisunique
      AND pg_get_expr(ix.indpred, ix.indrelid) ILIKE '%contract_address%IS NOT NULL%'
    THEN 'OK'
    WHEN ix.indisunique
      AND indexdef NOT ILIKE '%NULLS NOT DISTINCT%'
      AND (
        pg_get_expr(ix.indpred, ix.indrelid) IS NULL
        OR pg_get_expr(ix.indpred, ix.indrelid) ILIKE '%IS NOT NULL%'
      )
    THEN 'OK'
    ELSE 'UNEXPECTED'
  END AS status
FROM pg_class i
JOIN pg_index ix ON ix.indexrelid = i.oid
JOIN pg_indexes pi
  ON pi.indexname = i.relname
 AND pi.schemaname = 'public'
WHERE i.relname = 'treasury_assets_chain_contract_uidx'
  AND i.relnamespace = 'public'::regnamespace;

-- ---------------------------------------------------------------------------
-- B) Official/public uniqueness index unchanged
-- ---------------------------------------------------------------------------
SELECT
  'B_OFFICIAL_PUBLIC_UIDX' AS section,
  i.relname AS index_name,
  ix.indisunique AS is_unique,
  pg_get_expr(ix.indpred, ix.indrelid) AS predicate,
  CASE
    WHEN ix.indisunique
      AND pg_get_expr(ix.indpred, ix.indrelid) ILIKE '%4663%'
      AND pg_get_expr(ix.indpred, ix.indrelid) ILIKE '%official%'
      AND pg_get_expr(ix.indpred, ix.indrelid) ILIKE '%public_contract%'
    THEN 'OK'
    ELSE 'UNEXPECTED'
  END AS status
FROM pg_class i
JOIN pg_index ix ON ix.indexrelid = i.oid
WHERE i.relname = 'treasury_assets_one_official_public_4663_uidx'
  AND i.relnamespace = 'public'::regnamespace;

-- ---------------------------------------------------------------------------
-- C) Coexistence check (read-only): ETH + optional dormant FENN on 4663
-- ---------------------------------------------------------------------------
SELECT
  'C_NULL_CONTRACT_ROWS_4663' AS section,
  symbol,
  chain_id,
  contract_address,
  decimals,
  metadata->>'asset_type' AS asset_type,
  metadata->>'official' AS official,
  metadata->>'public_contract' AS public_contract
FROM public.treasury_assets
WHERE chain_id = 4663
  AND contract_address IS NULL
ORDER BY symbol;

-- ---------------------------------------------------------------------------
-- D) Write probes (run with BEGIN; ... ROLLBACK;)
--    1) Two simultaneous null contracts on 4663 — should succeed
--    2) Duplicate non-null contract on 4663 — should fail
-- ---------------------------------------------------------------------------
-- BEGIN;
--
-- -- D1: temporary dual-null coexistence (rollback)
-- INSERT INTO public.treasury_assets (
--   symbol, name, chain_id, contract_address, decimals, is_tracked, display_order, metadata
-- ) VALUES (
--   'ETH_PROBE', 'Ether probe', 4663, NULL, 18, true, 999,
--   jsonb_build_object('asset_type', 'native', 'network', 'robinhood_chain')
-- );
-- INSERT INTO public.treasury_assets (
--   symbol, name, chain_id, contract_address, decimals, is_tracked, display_order, metadata
-- ) VALUES (
--   'FENN_PROBE', 'FENN probe', 4663, NULL, 18, true, 998,
--   jsonb_build_object(
--     'asset_type', 'erc20',
--     'network', 'robinhood_chain',
--     'official', true,
--     'public_contract', true
--   )
-- );
-- -- Expect: both succeed when no official row already exists for the second.
-- -- (If official FENN already prepared, second insert may fail official-public uidx — OK.)
--
-- -- D2: duplicate non-null
-- -- INSERT INTO public.treasury_assets (...) VALUES (..., '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ...);
-- -- INSERT INTO public.treasury_assets (...) VALUES (..., '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ...);
-- -- Expect: second insert → unique_violation on treasury_assets_chain_contract_uidx
--
-- ROLLBACK;
