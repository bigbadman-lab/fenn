-- FENN — Official public $FENN token (treasury_assets metadata)
-- LOCAL ONLY — do not apply until explicitly authorised.
--
-- Product surface uses rows in public.treasury_assets, not treasury_config.
-- No placeholder contract is inserted. Pre-launch (zero official rows) is valid.
--
-- Launch-day operators set metadata.official + metadata.public_contract on the
-- official Robinhood Chain ERC-20 row. See:
--   supabase/examples/official_fenn_token_ops_example.sql

-- At most one official public-contract row on Robinhood Chain (chain_id 4663).
-- Does not require is_tracked or a contract — those are enforced in application
-- selection — so ambiguous operator flags still fail closed at the database.
CREATE UNIQUE INDEX IF NOT EXISTS treasury_assets_one_official_public_4663_uidx
  ON public.treasury_assets ((true))
  WHERE chain_id = 4663
    AND (metadata->>'official') = 'true'
    AND (metadata->>'public_contract') = 'true';

COMMENT ON INDEX public.treasury_assets_one_official_public_4663_uidx IS
  'At most one official public token contract flag on Robinhood Chain (4663).';
