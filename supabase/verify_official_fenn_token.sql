-- FENN — Verify official public $FENN token support (read-only)
--
-- PREREQUISITE: migrations through 20260803150000_44_official_fenn_token.sql
--
-- Does NOT insert a contract address.
-- Does NOT call RPC.

-- ---------------------------------------------------------------------------
-- A) Partial unique index present
-- ---------------------------------------------------------------------------
SELECT
  'A_OFFICIAL_PUBLIC_INDEX' AS section,
  c.relname AS index_name,
  CASE
    WHEN c.relname IS NOT NULL THEN 'OK'
    ELSE 'MISSING'
  END AS status
FROM (VALUES ('treasury_assets_one_official_public_4663_uidx')) AS t(index_name)
LEFT JOIN pg_class c
  ON c.relname = t.index_name
 AND c.relnamespace = 'public'::regnamespace;

-- ---------------------------------------------------------------------------
-- B) Index is unique + partial on official/public flags for chain 4663
-- ---------------------------------------------------------------------------
SELECT
  'B_INDEX_DEFINITION' AS section,
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
-- C) Forbidden: official token must NOT live on treasury_config
-- ---------------------------------------------------------------------------
SELECT
  'C_NO_CONFIG_TOKEN_COLUMNS' AS section,
  t.column_name,
  CASE
    WHEN c.column_name IS NULL THEN 'OK_ABSENT'
    ELSE 'UNEXPECTED_PRESENT'
  END AS status
FROM (
  VALUES
    ('fenn_token_address'),
    ('token_contract_address'),
    ('official_token_address'),
    ('public_token_address')
) AS t(column_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = 'treasury_config'
 AND c.column_name = t.column_name
ORDER BY status DESC, t.column_name;

-- ---------------------------------------------------------------------------
-- D) Pre-launch valid: zero or one official public row is fine
-- ---------------------------------------------------------------------------
SELECT
  'D_OFFICIAL_PUBLIC_ROW_COUNT' AS section,
  count(*)::int AS official_public_rows,
  CASE
    WHEN count(*) <= 1 THEN 'OK'
    ELSE 'AMBIGUOUS'
  END AS status
FROM public.treasury_assets
WHERE chain_id = 4663
  AND (metadata->>'official') = 'true'
  AND (metadata->>'public_contract') = 'true';
