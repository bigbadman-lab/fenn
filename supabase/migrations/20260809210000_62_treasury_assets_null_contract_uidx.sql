-- FENN P2C.1 — treasury_assets null-contract uniqueness correction
--
-- Root cause: treasury_assets_chain_contract_uidx used NULLS NOT DISTINCT,
-- so all (chain_id, NULL) rows collided. One native ETH (NULL contract) on
-- 4663 blocked a dormant official FENN (also NULL contract).
--
-- Law after this migration:
--   Unique (chain_id, contract_address) ONLY WHERE contract_address IS NOT NULL
--   Multiple NULL-contract rows on the same chain are allowed
--     (native ETH, dormant ERC-20 FENN, etc.)
--
-- Does NOT:
--   - touch treasury_assets_one_official_public_4663_uidx
--   - delete/rewrite rows
--   - activate settlement
--   - change official-token resolver application law

DROP INDEX IF EXISTS public.treasury_assets_chain_contract_uidx;

CREATE UNIQUE INDEX treasury_assets_chain_contract_uidx
  ON public.treasury_assets (chain_id, contract_address)
  WHERE contract_address IS NOT NULL;

COMMENT ON INDEX public.treasury_assets_chain_contract_uidx IS
  'Non-null ERC-20 contract addresses unique per chain_id. '
  'NULL contract_address rows (native assets / dormant official FENN) may coexist.';
