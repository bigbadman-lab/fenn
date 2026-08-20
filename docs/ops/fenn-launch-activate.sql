-- VELL launch — official Solana mint activation (OPS, not a migration)
--
-- EMERGENCY / MANUAL FALLBACK ONLY.
-- Primary launch-day path:
--   npm run vell:activate -- --contract <SolanaMintBase58>
--
-- Use this SQL only when the CLI cannot run. Same safety law:
-- AFTER the SPL mint is deployed and the mint address is verified.
--
-- Single operator action:
--   1. Replace the placeholder OFFICIAL_VELL_MINT below with the real mint
--   2. Run this file once against production Supabase
--
-- Updates ONLY treasury_assets.contract_address (and updated_at via trigger).
-- Does NOT:
--   - change decimals / metadata / chain / symbol
--   - fund the Purse
--   - set purse_config.official_settlement_activated_at
--   - toggle economic_settlement_enabled
--
-- Placeholder MUST remain so this fails closed if forgotten.
-- Requires migration 65 (Solana contract_address CHECK + official/public 101 uidx).

BEGIN;

-- ---------------------------------------------------------------------------
-- Set the launch mint (edit ONLY this line).
-- Must be a valid Solana base58 address (is_normalized_solana_address).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  -- >>> REPLACE THIS VALUE WITH THE VERIFIED OFFICIAL $VELL MINT <<<
  v_raw text := 'OFFICIAL_VELL_MINT';
  v_addr text;
  v_updated integer;
  v_id uuid;
BEGIN
  -- Refuse obvious placeholder leftovers
  IF v_raw IS NULL
     OR position('OFFICIAL_VELL_MINT' in upper(v_raw)) > 0
     OR position('REPLACE' in upper(v_raw)) > 0
  THEN
    RAISE EXCEPTION
      'VELL_LAUNCH_ACTIVATE_ABORT: replace OFFICIAL_VELL_MINT with the real Solana mint before running';
  END IF;

  v_addr := trim(v_raw);

  IF NOT public.is_normalized_solana_address(v_addr) THEN
    RAISE EXCEPTION
      'VELL_LAUNCH_ACTIVATE_ABORT: mint is not a normalized Solana address: %',
      v_addr;
  END IF;

  -- Exactly one dormant official target (Solana sentinel 101)
  SELECT id INTO v_id
  FROM public.treasury_assets
  WHERE chain_id = 101
    AND upper(trim(symbol)) = 'VELL'
    AND decimals = 6
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
      WHERE chain_id = 101
        AND (metadata->>'official') = 'true'
        AND (metadata->>'public_contract') = 'true'
        AND contract_address IS NOT NULL
    ) THEN
      RAISE EXCEPTION
        'VELL_LAUNCH_ACTIVATE_ABORT: official mint already set — refusing overwrite';
    END IF;

    RAISE EXCEPTION
      'VELL_LAUNCH_ACTIVATE_ABORT: no dormant official VELL row found (run fenn-launch-prep.sql first)';
  END IF;

  UPDATE public.treasury_assets
  SET contract_address = v_addr
  WHERE id = v_id
    AND contract_address IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> 1 THEN
    RAISE EXCEPTION
      'VELL_LAUNCH_ACTIVATE_ABORT: expected 1 row updated, got %',
      v_updated;
  END IF;

  RAISE NOTICE
    'VELL_LAUNCH_ACTIVATE_OK: id=% contract_address=%',
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
  metadata->>'asset_type' AS asset_type,
  'official_mint_set' AS activate_status
FROM public.treasury_assets
WHERE chain_id = 101
  AND (metadata->>'official') = 'true'
  AND (metadata->>'public_contract') = 'true';
