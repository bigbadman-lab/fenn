-- FENN P2C.1 — Prepare dormant official $FENN row (OPS, not a migration)
--
-- Run as ONE paste in Supabase SQL Editor (or a single psql session).
-- Does NOT insert a migration. Does NOT activate settlement.
-- Does NOT set contract_address.
-- Does NOT modify the existing ETH / native NULL-contract row.
--
-- Implementation note:
--   Scan + conflict + insert live in a single DO $$ block. Do not use a CTE or
--   TEMP TABLE across statements — Supabase SQL editor may not preserve session
--   scope between statement boundaries.
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
--                 null_contract_coexistence: ETH + dormant FENN both may use
--                 contract_address NULL on chain 4663

DO $$
DECLARE
  n_official integer;
  n_live integer;
  live_addr text;
  r record;
BEGIN
  -- Count official/public candidates on Robinhood Chain
  SELECT count(*)::integer
  INTO n_official
  FROM public.treasury_assets
  WHERE chain_id = 4663
    AND (metadata->>'official') = 'true'
    AND (metadata->>'public_contract') = 'true';

  IF n_official > 1 THEN
    RAISE EXCEPTION
      'FENN_LAUNCH_PREP_CONFLICT: % official/public rows on chain 4663 — fix manually, do not duplicate',
      n_official;
  END IF;

  -- Live contract already present — never overwrite
  SELECT count(*)::integer, max(contract_address)
  INTO n_live, live_addr
  FROM public.treasury_assets
  WHERE chain_id = 4663
    AND (metadata->>'official') = 'true'
    AND (metadata->>'public_contract') = 'true'
    AND contract_address IS NOT NULL
    AND length(trim(contract_address)) > 0;

  IF n_live > 0 THEN
    RAISE EXCEPTION
      'FENN_LAUNCH_PREP_ALREADY_LIVE: official row already has contract_address=% — do not overwrite',
      live_addr;
  END IF;

  -- Existing dormant match — already prepared (no insert / no ETH touch)
  SELECT
    id,
    symbol,
    chain_id,
    contract_address,
    decimals,
    is_tracked,
    metadata
  INTO r
  FROM public.treasury_assets
  WHERE chain_id = 4663
    AND (metadata->>'official') = 'true'
    AND (metadata->>'public_contract') = 'true'
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

-- ---------------------------------------------------------------------------
-- Verification (read-only) — ETH + FENN null-contract rows on 4663
-- ---------------------------------------------------------------------------
SELECT
  symbol,
  chain_id,
  contract_address,
  decimals,
  metadata
FROM public.treasury_assets
WHERE chain_id = 4663
  AND (
    upper(trim(symbol)) = 'ETH'
    OR (
      (metadata->>'official') = 'true'
      AND (metadata->>'public_contract') = 'true'
    )
  )
ORDER BY symbol;
