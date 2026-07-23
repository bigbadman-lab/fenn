-- FENN Stage 9 — Verification for Treasury + Commons (read-only)
--
-- PREREQUISITE: Stage 2 migrations applied (especially
--   20260722180007_07_treasury_commons.sql
--   20260722180010_10_rls.sql
--   20260722180008_08_circulations.sql)
--
-- Does NOT call Robinhood Chain RPC.
-- Does NOT insert operator Treasury wallets or tracked assets.
-- Does NOT mutate economic state permanently.

-- ---------------------------------------------------------------------------
-- A) Tables present
-- ---------------------------------------------------------------------------
SELECT
  'A_TABLES' AS section,
  t.table_name,
  CASE WHEN c.relname IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM (
  VALUES
    ('treasury_config'),
    ('treasury_assets'),
    ('treasury_contributions'),
    ('commons_commitments'),
    ('commons_allocations'),
    ('circulations'),
    ('circulation_recipients')
) AS t(table_name)
LEFT JOIN pg_class c
  ON c.relname = t.table_name
 AND c.relnamespace = 'public'::regnamespace
ORDER BY status DESC, t.table_name;

-- ---------------------------------------------------------------------------
-- B) Forbidden live-balance / launchpad columns (Stage 9 authority)
-- ---------------------------------------------------------------------------
SELECT
  'B_FORBIDDEN_COLUMNS' AS section,
  t.table_name,
  t.column_name,
  CASE
    WHEN c.column_name IS NULL THEN 'OK_ABSENT'
    ELSE 'UNEXPECTED_PRESENT'
  END AS status
FROM (
  VALUES
    ('treasury_config', 'balance'),
    ('treasury_config', 'balance_usd'),
    ('treasury_config', 'balance_raw'),
    ('treasury_config', 'cached_balance'),
    ('treasury_config', 'fenn_token_address'),
    ('treasury_config', 'token_contract_address'),
    ('treasury_config', 'launchpad_notes'),
    ('treasury_assets', 'balance'),
    ('treasury_assets', 'live_balance'),
    ('treasury_assets', 'balance_raw'),
    ('treasury_assets', 'cached_balance'),
    ('commons_commitments', 'balance'),
    ('commons_commitments', 'treasury_held'),
    ('commons_allocations', 'recipient_wallet'),
    ('commons_allocations', 'paid'),
    ('commons_allocations', 'tx_hash'),
    ('commons_allocations', 'circulation_id')
) AS t(table_name, column_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = t.table_name
 AND c.column_name = t.column_name
ORDER BY status DESC, t.table_name, t.column_name;

-- ---------------------------------------------------------------------------
-- C) Required columns
-- ---------------------------------------------------------------------------
SELECT
  'C_REQUIRED_COLUMNS' AS section,
  ec.table_name,
  ec.column_name,
  CASE
    WHEN c.column_name IS NOT NULL THEN 'OK'
    ELSE 'MISSING'
  END AS status
FROM (
  VALUES
    ('treasury_config', 'treasury_wallet_address'),
    ('treasury_assets', 'symbol'),
    ('treasury_assets', 'chain_id'),
    ('treasury_assets', 'contract_address'),
    ('treasury_assets', 'decimals'),
    ('treasury_assets', 'is_tracked'),
    ('treasury_assets', 'display_order'),
    ('treasury_contributions', 'amount'),
    ('treasury_contributions', 'verified'),
    ('treasury_contributions', 'verified_at'),
    ('treasury_contributions', 'notes'),
    ('commons_commitments', 'asset_symbol'),
    ('commons_commitments', 'amount'),
    ('commons_commitments', 'value_usd_manual'),
    ('commons_commitments', 'notes'),
    ('commons_commitments', 'updated_by_actor_id'),
    ('commons_allocations', 'asset_symbol'),
    ('commons_allocations', 'delta_amount'),
    ('commons_allocations', 'reason'),
    ('commons_allocations', 'actor_id'),
    ('commons_allocations', 'created_at')
) AS ec(table_name, column_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = ec.table_name
 AND c.column_name = ec.column_name
ORDER BY status DESC, ec.table_name, ec.column_name;

-- ---------------------------------------------------------------------------
-- D) Constraints / indexes critical to Stage 9
-- ---------------------------------------------------------------------------
SELECT
  'D_CONSTRAINTS' AS section,
  expected.kind,
  expected.name,
  CASE
    WHEN expected.kind = 'constraint' AND EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public' AND c.conname = expected.name
    ) THEN 'OK'
    WHEN expected.kind = 'index' AND EXISTS (
      SELECT 1 FROM pg_indexes i
      WHERE i.schemaname = 'public' AND i.indexname = expected.name
    ) THEN 'OK'
    ELSE 'MISSING'
  END AS status
FROM (
  VALUES
    ('constraint', 'treasury_config_wallet_normalized'),
    ('index', 'treasury_config_singleton_uidx'),
    ('constraint', 'treasury_assets_decimals_nonnegative'),
    ('constraint', 'treasury_assets_contract_address_normalized'),
    ('index', 'treasury_assets_chain_contract_uidx'),
    ('constraint', 'treasury_contributions_amount_positive'),
    ('constraint', 'commons_commitments_amount_nonnegative'),
    ('index', 'commons_commitments_asset_symbol_uidx'),
    ('constraint', 'commons_allocations_delta_nonzero'),
    ('constraint', 'commons_allocations_reason_nonempty'),
    ('constraint', 'circulation_recipients_wallet_normalized')
) AS expected(kind, name)
ORDER BY status DESC, expected.kind, expected.name;

-- Confirm native asset (NULL contract) uniqueness semantics exist
SELECT
  'D_NATIVE_NULL_IDENTITY' AS section,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = 'treasury_assets_chain_contract_uidx';
-- expect NULLS NOT DISTINCT (or equivalent unique on (chain_id, contract_address))

-- ---------------------------------------------------------------------------
-- E) RLS enabled
-- ---------------------------------------------------------------------------
SELECT
  'E_RLS_ENABLED' AS section,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  CASE WHEN c.relrowsecurity THEN 'OK' ELSE 'FAIL' END AS status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = ANY (ARRAY[
    'treasury_config',
    'treasury_assets',
    'treasury_contributions',
    'commons_commitments',
    'commons_allocations',
    'circulations',
    'circulation_recipients'
  ])
ORDER BY status DESC, table_name;

-- ---------------------------------------------------------------------------
-- F) Public SELECT policies (expected vs Stage 10 recipient lock)
-- ---------------------------------------------------------------------------
SELECT
  'F_POLICIES' AS section,
  expected.policyname,
  expected.tablename,
  CASE
    WHEN p.policyname IS NOT NULL THEN 'OK_PRESENT'
    ELSE 'MISSING'
  END AS status
FROM (
  VALUES
    ('treasury_config_public_select', 'treasury_config'),
    ('treasury_assets_public_select', 'treasury_assets'),
    ('treasury_contributions_public_select', 'treasury_contributions'),
    ('commons_commitments_public_select', 'commons_commitments'),
    ('commons_allocations_public_select', 'commons_allocations'),
    ('circulations_public_select', 'circulations')
) AS expected(policyname, tablename)
LEFT JOIN pg_policies p
  ON p.schemaname = 'public'
 AND p.policyname = expected.policyname
 AND p.tablename = expected.tablename
ORDER BY status DESC, expected.tablename;

-- circulation_recipients must NOT have a public SELECT policy
SELECT
  'F_NO_RECIPIENT_PUBLIC_SELECT' AS section,
  COUNT(*)::int AS public_select_policies,
  CASE
    WHEN COUNT(*) = 0 THEN 'OK_NO_PUBLIC_SELECT'
    ELSE 'FAIL_UNEXPECTED_POLICY'
  END AS status
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'circulation_recipients'
  AND cmd = 'SELECT'
  AND (
    'anon' = ANY (roles)
    OR 'authenticated' = ANY (roles)
    OR 'public' = ANY (roles)
  );

-- Verified-only contribution policy definition (inspect manually)
SELECT
  'F_CONTRIBUTIONS_POLICY_DEF' AS section,
  policyname,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'treasury_contributions'
  AND policyname = 'treasury_contributions_public_select';
-- expect USING (verified = true)

-- ---------------------------------------------------------------------------
-- G) Browser mutation grants must be absent
-- ---------------------------------------------------------------------------
SELECT
  'G_MUTATION_GRANT_VIOLATIONS' AS section,
  g.table_name,
  g.grantee,
  g.privilege_type,
  'FAIL_HAS_MUTATION_GRANT' AS status
FROM information_schema.role_table_grants g
WHERE g.table_schema = 'public'
  AND g.grantee IN ('anon', 'authenticated')
  AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  AND g.table_name = ANY (ARRAY[
    'treasury_config',
    'treasury_assets',
    'treasury_contributions',
    'commons_commitments',
    'commons_allocations',
    'circulations',
    'circulation_recipients'
  ])
ORDER BY g.table_name, g.grantee, g.privilege_type;
-- expect zero rows

-- ---------------------------------------------------------------------------
-- H) Configuration readiness snapshot (informational — not a fail)
-- ---------------------------------------------------------------------------
SELECT
  'H_CONFIG_STATUS' AS section,
  (SELECT COUNT(*)::int FROM public.treasury_config) AS treasury_config_rows,
  (SELECT COUNT(*)::int FROM public.treasury_assets WHERE is_tracked = true) AS tracked_assets,
  (SELECT COUNT(*)::int FROM public.treasury_contributions WHERE verified = true) AS verified_contributions,
  (SELECT COUNT(*)::int FROM public.commons_commitments) AS commons_commitment_rows,
  (SELECT COUNT(*)::int FROM public.commons_allocations) AS commons_allocation_rows,
  (SELECT COUNT(*)::int FROM public.circulations) AS circulation_rows,
  (SELECT COUNT(*)::int FROM public.circulation_recipients) AS recipient_rows;

SELECT
  'H_CONFIG_HINT' AS section,
  CASE
    WHEN (SELECT COUNT(*) FROM public.treasury_config) = 0
      THEN 'Treasury unconfigured — insert treasury_config + tracked assets + set ROBINHOOD_CHAIN_RPC_URL'
    WHEN (SELECT COUNT(*) FROM public.treasury_assets WHERE is_tracked = true) = 0
      THEN 'Treasury wallet present — add tracked treasury_assets (chain_id 4663) for live reads'
    ELSE 'Treasury config + tracked assets present — live balances still require ROBINHOOD_CHAIN_RPC_URL'
  END AS operator_hint;

-- ---------------------------------------------------------------------------
-- I) Pass summary (constraints that must be green)
-- ---------------------------------------------------------------------------
SELECT
  'I_SUMMARY' AS section,
  (SELECT COUNT(*) = 0 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND (
        (c.table_name = 'treasury_config' AND c.column_name IN ('balance', 'balance_usd', 'balance_raw', 'cached_balance'))
        OR (c.table_name = 'treasury_assets' AND c.column_name IN ('balance', 'live_balance', 'balance_raw', 'cached_balance'))
        OR (c.table_name = 'commons_allocations' AND c.column_name IN ('recipient_wallet', 'paid', 'tx_hash', 'circulation_id'))
      )
  ) AS no_forbidden_balance_columns,
  (SELECT COUNT(*) = 0 FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public'
      AND g.grantee IN ('anon', 'authenticated')
      AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
      AND g.table_name = ANY (ARRAY[
        'treasury_config', 'treasury_assets', 'treasury_contributions',
        'commons_commitments', 'commons_allocations', 'circulations',
        'circulation_recipients'
      ])
  ) AS no_browser_mutation_grants,
  (SELECT COUNT(*) = 0 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'circulation_recipients'
      AND cmd = 'SELECT'
      AND ('anon' = ANY (roles) OR 'authenticated' = ANY (roles) OR 'public' = ANY (roles))
  ) AS no_recipient_public_select,
  (SELECT relrowsecurity FROM pg_class
    WHERE relnamespace = 'public'::regnamespace AND relname = 'treasury_config'
  ) AS treasury_config_rls,
  (SELECT COUNT(*) FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'treasury_config_singleton_uidx'
  ) = 1 AS treasury_singleton_index;
