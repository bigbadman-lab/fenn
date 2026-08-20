-- VELL launch prep — dormant official $VELL mint row on Solana (OPS, not a migration)
--
-- Run as ONE paste in Supabase SQL Editor (or a single psql session).
-- Requires migration 65 (Solana contract_address CHECK + official/public 101 uidx).
--
-- Does NOT set contract_address (mint stays NULL until npm run vell:activate).
-- Does NOT modify ETH / Robinhood (4663) treasury rows.
-- Demotes any leftover Robinhood official/public FENN flags so the public
-- resolver has a single Solana official source of truth.

DO $prep$
DECLARE
  n_official   integer;
  n_live       integer;
  n_dormant    integer;
  existing_id  uuid;
  existing_symbol text;
  existing_decimals integer;
  existing_tracked boolean;
  existing_chain integer;
  live_addr    text;
  demoted      integer;
BEGIN
  -- Demote legacy Robinhood official/public FENN flags (display mint is Solana).
  UPDATE public.treasury_assets t
  SET metadata = (t.metadata - 'official' - 'public_contract')
                 || jsonb_build_object(
                      'official', false,
                      'public_contract', false,
                      'superseded_by', 'solana_official_vell'
                    )
  WHERE t.chain_id = 4663
    AND lower(trim(t.symbol)) IN ('fenn', 'vell')
    AND (t.metadata->>'official') = 'true'
    AND (t.metadata->>'public_contract') = 'true';

  GET DIAGNOSTICS demoted = ROW_COUNT;
  IF demoted > 0 THEN
    RAISE NOTICE
      'VELL_LAUNCH_PREP: demoted % Robinhood official/public row(s)',
      demoted;
  END IF;

  -- Count Solana official/public candidates
  n_official := (
    SELECT count(*)::integer
    FROM public.treasury_assets t
    WHERE t.chain_id = 101
      AND lower(trim(t.symbol)) = 'vell'
      AND (t.metadata->>'official') = 'true'
      AND (t.metadata->>'public_contract') = 'true'
  );

  IF n_official > 1 THEN
    RAISE EXCEPTION
      'VELL_LAUNCH_PREP_CONFLICT: % official/public VELL rows on Solana (101) — fix manually',
      n_official;
  END IF;

  n_live := (
    SELECT count(*)::integer
    FROM public.treasury_assets t
    WHERE t.chain_id = 101
      AND lower(trim(t.symbol)) = 'vell'
      AND (t.metadata->>'official') = 'true'
      AND (t.metadata->>'public_contract') = 'true'
      AND t.contract_address IS NOT NULL
      AND length(trim(t.contract_address)) > 0
  );

  IF n_live > 0 THEN
    live_addr := (
      SELECT max(t.contract_address)
      FROM public.treasury_assets t
      WHERE t.chain_id = 101
        AND lower(trim(t.symbol)) = 'vell'
        AND (t.metadata->>'official') = 'true'
        AND (t.metadata->>'public_contract') = 'true'
        AND t.contract_address IS NOT NULL
        AND length(trim(t.contract_address)) > 0
    );
    RAISE EXCEPTION
      'VELL_LAUNCH_PREP_ALREADY_LIVE: official VELL already has mint=% — do not overwrite',
      live_addr;
  END IF;

  n_dormant := (
    SELECT count(*)::integer
    FROM public.treasury_assets t
    WHERE t.chain_id = 101
      AND lower(trim(t.symbol)) = 'vell'
      AND (t.metadata->>'official') = 'true'
      AND (t.metadata->>'public_contract') = 'true'
      AND t.contract_address IS NULL
  );

  IF n_dormant = 1 THEN
    SELECT
      t.id,
      t.symbol,
      t.chain_id,
      t.decimals,
      t.is_tracked
    INTO
      existing_id,
      existing_symbol,
      existing_chain,
      existing_decimals,
      existing_tracked
    FROM public.treasury_assets t
    WHERE t.chain_id = 101
      AND lower(trim(t.symbol)) = 'vell'
      AND (t.metadata->>'official') = 'true'
      AND (t.metadata->>'public_contract') = 'true'
      AND t.contract_address IS NULL
    LIMIT 1;

    IF upper(trim(existing_symbol)) <> 'VELL' THEN
      RAISE EXCEPTION
        'VELL_LAUNCH_PREP_CONFLICT: existing official row symbol=% (expected VELL)',
        existing_symbol;
    END IF;
    IF existing_chain IS DISTINCT FROM 101 THEN
      RAISE EXCEPTION
        'VELL_LAUNCH_PREP_CONFLICT: existing official row chain_id=% (expected 101)',
        existing_chain;
    END IF;
    IF existing_tracked IS NOT TRUE THEN
      RAISE EXCEPTION
        'VELL_LAUNCH_PREP_CONFLICT: existing official row is_tracked is false';
    END IF;

    -- Upgrade earlier prep that inserted decimals=9 before launch settled on 6.
    IF existing_decimals IS DISTINCT FROM 6 THEN
      IF existing_decimals IS DISTINCT FROM 9 THEN
        RAISE EXCEPTION
          'VELL_LAUNCH_PREP_CONFLICT: existing official row decimals=% (expected 6)',
          existing_decimals;
      END IF;

      UPDATE public.treasury_assets
      SET decimals = 6
      WHERE id = existing_id
        AND contract_address IS NULL
        AND decimals = 9;

      RAISE NOTICE
        'VELL_LAUNCH_PREP_OK: upgraded dormant official VELL id=% decimals 9→6',
        existing_id;
      RETURN;
    END IF;

    RAISE NOTICE
      'VELL_LAUNCH_PREP_OK: already prepared (dormant official VELL id=% contract_address=NULL)',
      existing_id;
    RETURN;
  END IF;

  IF n_official = 0 AND n_dormant = 0 THEN
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
      'VELL',
      'VELL',
      101,
      NULL,
      6,
      true,
      10,
      jsonb_build_object(
        'asset_type', 'spl',
        'network', 'mainnet-beta',
        'official', true,
        'public_contract', true
      )
    );

    RAISE NOTICE
      'VELL_LAUNCH_PREP_OK: inserted dormant official VELL row (Solana mint NULL)';
    RETURN;
  END IF;

  RAISE EXCEPTION
    'VELL_LAUNCH_PREP_CONFLICT: unexpected counts n_official=% n_dormant=% n_live=%',
    n_official, n_dormant, n_live;
END
$prep$;

-- Verification (read-only)
SELECT
  symbol,
  name,
  chain_id,
  contract_address,
  decimals,
  is_tracked,
  display_order,
  metadata
FROM public.treasury_assets
WHERE (
    chain_id = 101 AND lower(symbol) = 'vell'
  )
  OR (
    chain_id = 4663 AND lower(symbol) IN ('eth', 'fenn', 'vell')
  )
ORDER BY chain_id, display_order, symbol;
