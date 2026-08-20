-- Official $VELL mint on Solana — allow Solana addresses on treasury_assets
-- and at most one official/public row on Solana mainnet sentinel chain_id 101.
--
-- Does not remove the Robinhood (4663) uniqueness index.
-- Does not mutate existing ETH / dormant Robinhood FENN rows.

-- Accept EVM or Solana contract_address (NULL still allowed for dormant rows).
ALTER TABLE public.treasury_assets
  DROP CONSTRAINT IF EXISTS treasury_assets_contract_address_normalized;

ALTER TABLE public.treasury_assets
  ADD CONSTRAINT treasury_assets_contract_address_normalized
  CHECK (
    contract_address IS NULL
    OR public.is_normalized_evm_address(contract_address)
    OR public.is_normalized_solana_address(contract_address)
  );

COMMENT ON CONSTRAINT treasury_assets_contract_address_normalized
  ON public.treasury_assets IS
  'contract_address must be NULL, a normalized EVM address, or a Solana base58 mint/pubkey.';

-- At most one official public mint on Solana mainnet (app chain_id 101).
CREATE UNIQUE INDEX IF NOT EXISTS treasury_assets_one_official_public_101_uidx
  ON public.treasury_assets ((true))
  WHERE chain_id = 101
    AND (metadata->>'official') = 'true'
    AND (metadata->>'public_contract') = 'true';

COMMENT ON INDEX public.treasury_assets_one_official_public_101_uidx IS
  'At most one official public $VELL mint flag on Solana mainnet (chain_id 101).';
