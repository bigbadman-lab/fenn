-- FENN P2C.1 — Prepare dormant official $FENN row (OPS, not a migration)
--
-- Run ONCE tonight against production Supabase (SQL editor / psql).
-- Does NOT insert a migration. Does NOT activate settlement.
-- Does NOT set contract_address.
-- Does NOT modify the existing ETH / native NULL-contract row.
--
-- Post-condition:
--   ETH (or other native) NULL-contract row(s) on 4663 remain
--   Exactly one official/public FENN row on chain 4663
--   contract_address IS NULL
--   Application official-token resolver still reports unavailable (dormant)
--
-- Requires:
--   migration 44  treasury_assets_one_official_public_4663_uidx
--   migration 62  treasury_assets_chain_contract_uidx
--                 (NULL contracts coexist; non-null unique per chain)
--
-- Preflight (read-only): existing null-contract assets on 4663
-- SELECT symbol, contract_address, metadata
-- FROM public.treasury_assets
-- WHERE chain_id = 4663 AND contract_address IS NULL;
BEGIN;

-- ---------------------------------------------------------------------------
-- 0) Scan official/public flags on Robinhood Chain
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE fenn_launch_prep_scan ON COMMIT DROP AS
SELECT
  id,
  symbol,
  name,
  chain_id,
  contract_address,
  decimals,
  is_tracked,
  metadata,
  (metadata->>'official') AS official_flag,
  (metadata->>'public_contract') AS public_contract_flag
FROM public.treasury_assets
WHERE chain_id = 4663
  AND (metadata->>'official') = 'true'
  AND (metadata->>'public_contract') = 'true';

-- ---------------------------------------------------------------------------
-- 1) Conflict: more than one official/public row
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*)::integer INTO n FROM fenn_launch_prep_scan;
  IF n > 1 THEN
    RAISE EXCEPTION
      'FENN_LAUNCH_PREP_CONFLICT: % official/public rows on chain 4663 — fix manually, do not duplicate',
      n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Existing official row with a LIVE contract — never overwrite
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n_live integer;
  addr text;
BEGIN
  SELECT count(*)::integer, max(contract_address)
  INTO n_live, addr
  FROM fenn_launch_prep_scan
  WHERE contract_address IS NOT NULL
    AND length(trim(contract_address)) > 0;

  IF n_live > 0 THEN
    RAISE EXCEPTION
      'FENN_LAUNCH_PREP_ALREADY_LIVE: official row already has contract_address=% — do not overwrite',
      addr;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Existing dormant match — already prepared (no insert)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r
  FROM fenn_launch_prep_scan
  LIMIT 1;

  IF FOUND THEN
    IF upper(trim(r.symbol)) <> 'FENN' THEN
      RAISE EXCEPTION
        'FENN_LAUNCH_PREP_CONFLICT: existing official row symbol=% (expected FENN)',
        r.symbol;
    END IF;
    IF r.decimals IS DISTINCT FROM 18 THEN
      RAISE EXCEPTION
        'FENN_LAUNCH_PREP_CONFLICT: existing official row decimals=% (expected 18)',
        r.decimals;
    END IF;
    IF r.is_tracked IS NOT TRUE THEN
      RAISE EXCEPTION
        'FENN_LAUNCH_PREP_CONFLICT: existing official row is_tracked is false';
    END IF;
    IF r.contract_address IS NOT NULL THEN
      RAISE EXCEPTION
        'FENN_LAUNCH_PREP_CONFLICT: dormant check found non-null contract unexpectedly';
    END IF;

    RAISE NOTICE
      'FENN_LAUNCH_PREP_OK: dormant official row already prepared id=% contract_address=NULL',
      r.id;
  ELSE
    -- Insert dormant official public ERC-20 definition
    INSERT INTO public.treasury_assets (
      symbol,
      name,
      chain_id,
      contract_address,
      decimals,
      is_tracked,
      display_order,
      metadata
    )
    VALUES (
      'FENN',
      'FENN',
      4663,
      NULL,
      18,
      true,
      10,
      jsonb_build_object(
        'asset_type', 'erc20',
        'network', 'robinhood_chain',
        'official', true,
        'public_contract', true
      )
    );

    RAISE NOTICE
      'FENN_LAUNCH_PREP_OK: inserted dormant official FENN row (contract_address=NULL)';
  END IF;
END $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- 4) Post-check (operator should see one NULL-contract official row)
-- ---------------------------------------------------------------------------
SELECT
  id,
  symbol,
  chain_id,
  contract_address,
  decimals,
  is_tracked,
  metadata->>'official' AS official,
  metadata->>'public_contract' AS public_contract,
  metadata->>'asset_type' AS asset_type,
  'dormant_official_prepared' AS prep_status
FROM public.treasury_assets
WHERE chain_id = 4663
  AND (metadata->>'official') = 'true'
  AND (metadata->>'public_contract') = 'true';

-- Coexistence proof: native/null rows must still be present (ETH expected)
SELECT
  symbol,
  chain_id,
  contract_address,
  metadata->>'asset_type' AS asset_type,
  'null_contract_coexistence' AS coexistence_status
FROM public.treasury_assets
WHERE chain_id = 4663
  AND contract_address IS NULL
ORDER BY symbol;