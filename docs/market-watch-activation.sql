-- Market Watch 1.0A — ops configuration template (EXAMPLES ONLY).
-- Never use the addresses below on a live system. Replace every placeholder
-- with values verified against the official $FENN deployment + explorer.
--
-- Activation sequence:
-- 1. Official treasury_assets FENN row exists (metadata.official + public_contract).
-- 2. Official liquidity pool deployed; token0/token1 verified on-chain.
-- 3. INSERT/UPDATE this config with enabled=false.
-- 4. Worker mode FENN_MARKET_WATCH_MODE=dry_run; compare decoded Swap logs.
-- 5. Set enabled=true only after dry-run matches explorer.
-- 6. Worker mode FENN_MARKET_WATCH_MODE=live.

-- Example (DO NOT APPLY AS-IS):
/*
UPDATE public.market_watch_config
SET
  token_address = lower('0xYOUR_OFFICIAL_FENN_TOKEN_ADDRESS_HERE00001'),
  token_decimals = 18,
  token_symbol = 'FENN',
  pool_address = lower('0xYOUR_OFFICIAL_POOL_ADDRESS_HERE0000000002'),
  pool_kind = 'uniswap_v2', -- or uniswap_v3; never custom until decoder exists
  quote_token_address = lower('0xYOUR_QUOTE_TOKEN_ADDRESS_HERE000000000003'),
  quote_token_decimals = 18,
  quote_token_symbol = 'WETH',
  launch_block = 0, -- set to the real first block your pool exists
  confirmation_depth = 5,
  min_display_fenn_raw = 0, -- calibrate after launch from live sizes
  classification_version = 'mw_v1',
  enabled = false, -- stay false until dry_run verified
  updated_at = now(),
  updated_by = 'ops:manual'
WHERE id = 1;
*/
