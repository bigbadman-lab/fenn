-- FENN P2C.1 — Launch-day official $FENN contract activation (OPS, not a migration)
--
-- TOMORROW ONLY — after $FENN is deployed and the contract address is verified.
--
-- Single operator action:
--   1. Replace the placeholder 0xOFFICIAL_FENN_CONTRACT below with the real address
--   2. Run this file once against production Supabase
--
-- Updates ONLY treasury_assets.contract_address (and updated_at via trigger).
-- Does NOT:
--   - change decimals / metadata / chain / symbol
--   - fund the Purse
--   - set purse_config.official_settlement_activated_at (Purse Executor does that)
--   - toggle economic_settlement_enabled
--
-- Placeholder MUST remain exactly one token so this fails closed if forgotten.

BEGIN;

-- ---------------------------------------------------------------------------
-- Set the launch contract (edit ONLY this line).
-- Must be lowercase 0x + 40 hex to satisfy is_normalized_evm_address CHECK.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  -- >>> REPLACE THIS VALUE WITH THE VERIFIED OFFICIAL $FENN CONTRACT <<<
  v_raw text := '0xOFFICIAL_FENN_CONTRACT';
  v_addr text;
  v_updated integer;
  v_id uuid;
BEGIN
  -- Refuse obvious placeholder leftovers
  IF v_raw IS NULL
     OR position('OFFICIAL_FENN_CONTRACT' in upper(v_raw)) > 0
     OR position('REPLACE' in upper(v_raw)) > 0
  THEN
    RAISE EXCEPTION
      'FENN_LAUNCH_ACTIVATE_ABORT: replace 0xOFFICIAL_FENN_CONTRACT with the real address before running';
  END IF;

  v_addr := lower(trim(v_raw));

  IF NOT public.is_normalized_evm_address(v_addr) THEN
    RAISE EXCEPTION
      'FENN_LAUNCH_ACTIVATE_ABORT: contract address is not a normalized EVM address: %',
      v_addr;
  END IF;

  -- Exactly one dormant official target
  SELECT id INTO v_id
  FROM public.treasury_assets
  WHERE chain_id = 4663
    AND upper(trim(symbol)) = 'FENN'
    AND decimals = 18
    AND is_tracked = true
    AND (metadata->>'official') = 'true'
    AND (metadata->>'public_contract') = 'true'
    AND contract_address IS NULL
  FOR UPDATE;

  IF v_id IS NULL THEN
    -- Diagnose
    IF EXISTS (
      SELECT 1
      FROM public.treasury_assets
      WHERE chain_id = 4663
        AND (metadata->>'official') = 'true'
        AND (metadata->>'public_contract') = 'true'
        AND contract_address IS NOT NULL
    ) THEN
      RAISE EXCEPTION
        'FENN_LAUNCH_ACTIVATE_ABORT: official contract already set — refusing overwrite';
    END IF;

    RAISE EXCEPTION
      'FENN_LAUNCH_ACTIVATE_ABORT: no dormant official FENN row found (run fenn-launch-prep.sql first)';
  END IF;

  UPDATE public.treasury_assets
  SET contract_address = v_addr
  WHERE id = v_id
    AND contract_address IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> 1 THEN
    RAISE EXCEPTION
      'FENN_LAUNCH_ACTIVATE_ABORT: expected 1 row updated, got %',
      v_updated;
  END IF;

  RAISE NOTICE
    'FENN_LAUNCH_ACTIVATE_OK: id=% contract_address=%',
    v_id,
    v_addr;
END $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Post-check — expect one resolved official row
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
  'official_contract_set' AS activate_status
FROM public.treasury_assets
WHERE chain_id = 4663
  AND (metadata->>'official') = 'true'
  AND (metadata->>'public_contract') = 'true';
