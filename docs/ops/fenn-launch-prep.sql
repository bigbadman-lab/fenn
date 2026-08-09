-- FENN P2C.1 — Prepare dormant official $FENN row (OPS, not a migration)
--
-- Run as ONE paste in Supabase SQL Editor (or a single psql session).
-- Does NOT insert a migration. Does NOT activate settlement.
-- Does NOT set contract_address.
-- Does NOT modify the existing ETH / native NULL-contract row.
-- Does NOT update ETH. Does NOT activate settlement.
--
-- Implementation (PL/pgSQL law):
--   The entire prep decision runs inside ONE DO block.
--   Scalars (n_official, n_dormant, existing_id, …) are variables only —
--   never relations. Prefer  name := (SELECT …)  over SELECT … INTO name
--   so a flaky multi-statement splitter cannot treat INTO as table-create
--   SQL or leave a bare name that later resolves as FROM-relation (42P01).
--
-- Requires:
--   migration 44  treasury_assets_one_official_public_4663_uidx
--   migration 62  treasury_assets_chain_contract_uidx
--                 null_contract_coexistence: ETH + dormant FENN both may use
--                 contract_address NULL on chain 4663

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
BEGIN
  -- 1) Count official/public FENN candidates on Robinhood Chain
  n_official := (
    SELECT count(*)::integer
    FROM public.treasury_assets t
    WHERE t.chain_id = 4663
      AND lower(trim(t.symbol)) = 'fenn'
      AND (t.metadata->>'official') = 'true'
      AND (t.metadata->>'public_contract') = 'true'
  );

  -- 2) Multiple official/public FENN rows → fail loudly
  IF n_official > 1 THEN
    RAISE EXCEPTION
      'FENN_LAUNCH_PREP_CONFLICT: % official/public FENN rows on chain 4663 — fix manually, do not duplicate',
      n_official;
  END IF;

  -- 3) Exactly one live (non-null contract) → stop; never overwrite
  n_live := (
    SELECT count(*)::integer
    FROM public.treasury_assets t
    WHERE t.chain_id = 4663
      AND lower(trim(t.symbol)) = 'fenn'
      AND (t.metadata->>'official') = 'true'
      AND (t.metadata->>'public_contract') = 'true'
      AND t.contract_address IS NOT NULL
      AND length(trim(t.contract_address)) > 0
  );

  IF n_live > 0 THEN
    live_addr := (
      SELECT max(t.contract_address)
      FROM public.treasury_assets t
      WHERE t.chain_id = 4663
        AND lower(trim(t.symbol)) = 'fenn'
        AND (t.metadata->>'official') = 'true'
        AND (t.metadata->>'public_contract') = 'true'
        AND t.contract_address IS NOT NULL
        AND length(trim(t.contract_address)) > 0
    );
    RAISE EXCEPTION
      'FENN_LAUNCH_PREP_ALREADY_LIVE: official FENN already has contract_address=% — do not overwrite',
      live_addr;
  END IF;

  -- 4) Exactly one dormant row → verify and leave as-is
  n_dormant := (
    SELECT count(*)::integer
    FROM public.treasury_assets t
    WHERE t.chain_id = 4663
      AND lower(trim(t.symbol)) = 'fenn'
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
    WHERE t.chain_id = 4663
      AND lower(trim(t.symbol)) = 'fenn'
      AND (t.metadata->>'official') = 'true'
      AND (t.metadata->>'public_contract') = 'true'
      AND t.contract_address IS NULL
    LIMIT 1;

    IF upper(trim(existing_symbol)) <> 'FENN' THEN
      RAISE EXCEPTION
        'FENN_LAUNCH_PREP_CONFLICT: existing official row symbol=% (expected FENN)',
        existing_symbol;
    END IF;
    IF existing_chain IS DISTINCT FROM 4663 THEN
      RAISE EXCEPTION
        'FENN_LAUNCH_PREP_CONFLICT: existing official row chain_id=% (expected 4663)',
        existing_chain;
    END IF;
    IF existing_decimals IS DISTINCT FROM 18 THEN
      RAISE EXCEPTION
        'FENN_LAUNCH_PREP_CONFLICT: existing official row decimals=% (expected 18)',
        existing_decimals;
    END IF;
    IF existing_tracked IS NOT TRUE THEN
      RAISE EXCEPTION
        'FENN_LAUNCH_PREP_CONFLICT: existing official row is_tracked is false';
    END IF;

    RAISE NOTICE
      'FENN_LAUNCH_PREP_OK: already prepared (dormant official FENN id=% contract_address=NULL)',
      existing_id;
    RETURN;
  END IF;

  -- 5) None → insert dormant FENN (ETH and all other assets are never touched)
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
    RETURN;
  END IF;

  -- Defensive: any other cardinality combination
  RAISE EXCEPTION
    'FENN_LAUNCH_PREP_CONFLICT: unexpected counts n_official=% n_dormant=% n_live=%',
    n_official, n_dormant, n_live;
END
$prep$;

-- ---------------------------------------------------------------------------
-- Verification (read-only) — ETH + FENN on 4663
-- ---------------------------------------------------------------------------
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
WHERE chain_id = 4663
  AND lower(symbol) IN ('eth', 'fenn')
ORDER BY display_order, symbol;
