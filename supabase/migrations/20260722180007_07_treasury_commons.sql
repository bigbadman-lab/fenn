-- FENN Stage 2 — Migration 07: Treasury & Commons
-- LOCAL ONLY — do not apply until explicitly authorised.
--
-- No live balances as authoritative facts.
-- No $FENN contract / launchpad fields.
-- No seeded Treasury wallet address (runtime/admin configuration later).

-- ---------------------------------------------------------------------------
-- treasury_config (minimal wallet identity / operator notes)
-- ---------------------------------------------------------------------------
CREATE TABLE public.treasury_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treasury_wallet_address text NOT NULL,
  notes text,
  updated_by_actor_id text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT treasury_config_wallet_normalized
    CHECK (public.is_normalized_evm_address(treasury_wallet_address))
);

-- Intentionally at most one active config row for MVP simplicity.
CREATE UNIQUE INDEX treasury_config_singleton_uidx
  ON public.treasury_config ((true));

CREATE TRIGGER treasury_config_set_updated_at
  BEFORE UPDATE ON public.treasury_config
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.treasury_config IS
  'FENN Treasury wallet configuration. Do not store live balances or token contracts here.';

-- ---------------------------------------------------------------------------
-- treasury_assets (tracked asset definitions — not live balances)
-- ---------------------------------------------------------------------------
CREATE TABLE public.treasury_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  name text,
  chain_id integer NOT NULL,
  -- NULL contract_address = native asset on the chain.
  contract_address text,
  decimals integer NOT NULL,
  is_tracked boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT treasury_assets_symbol_nonempty
    CHECK (length(trim(symbol)) > 0),
  CONSTRAINT treasury_assets_decimals_nonnegative
    CHECK (decimals >= 0),
  CONSTRAINT treasury_assets_contract_address_normalized
    CHECK (
      contract_address IS NULL
      OR public.is_normalized_evm_address(contract_address)
    )
);

CREATE UNIQUE INDEX treasury_assets_chain_contract_uidx
  ON public.treasury_assets (chain_id, contract_address)
  NULLS NOT DISTINCT;

CREATE INDEX treasury_assets_tracked_order_idx
  ON public.treasury_assets (is_tracked, display_order);

CREATE TRIGGER treasury_assets_set_updated_at
  BEFORE UPDATE ON public.treasury_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.treasury_assets IS
  'Which assets FENN tracks for Treasury tooling. Live balances come from chain reads later.';

-- ---------------------------------------------------------------------------
-- treasury_contributions (verified inbound annotations / history)
-- ---------------------------------------------------------------------------
CREATE TABLE public.treasury_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid REFERENCES public.treasury_assets (id) ON DELETE SET NULL,
  asset_symbol text NOT NULL,
  amount numeric NOT NULL,
  amount_raw numeric,
  value_usd_at_receipt numeric,
  tx_hash text,
  from_address text,
  project_name text,
  purpose text,
  designation text NOT NULL DEFAULT 'treasury',
  verified boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT treasury_contributions_asset_symbol_nonempty
    CHECK (length(trim(asset_symbol)) > 0),
  CONSTRAINT treasury_contributions_amount_positive
    CHECK (amount > 0),
  CONSTRAINT treasury_contributions_designation_check
    CHECK (designation IN ('treasury', 'commons_intent', 'other')),
  CONSTRAINT treasury_contributions_from_address_normalized
    CHECK (
      from_address IS NULL
      OR public.is_normalized_evm_address(from_address)
    )
);

CREATE UNIQUE INDEX treasury_contributions_tx_asset_uidx
  ON public.treasury_contributions (tx_hash, asset_symbol)
  WHERE tx_hash IS NOT NULL;

CREATE INDEX treasury_contributions_verified_created_idx
  ON public.treasury_contributions (verified, created_at DESC);

CREATE TRIGGER treasury_contributions_set_updated_at
  BEFORE UPDATE ON public.treasury_contributions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.treasury_contributions IS
  'Verified contribution annotations. Not a substitute for live chain balance reads.';

-- Optional sponsored Deed link (column already on deeds).
ALTER TABLE public.deeds
  ADD CONSTRAINT deeds_sponsor_contribution_id_fkey
  FOREIGN KEY (sponsor_contribution_id)
  REFERENCES public.treasury_contributions (id)
  ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- commons_commitments (CURRENT explicitly committed Commons value)
-- ---------------------------------------------------------------------------
CREATE TABLE public.commons_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid REFERENCES public.treasury_assets (id) ON DELETE SET NULL,
  asset_symbol text NOT NULL,
  amount numeric NOT NULL,
  value_usd_manual numeric,
  notes text,
  updated_by_actor_id text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT commons_commitments_asset_symbol_nonempty
    CHECK (length(trim(asset_symbol)) > 0),
  CONSTRAINT commons_commitments_amount_nonnegative
    CHECK (amount >= 0)
);

CREATE UNIQUE INDEX commons_commitments_asset_symbol_uidx
  ON public.commons_commitments (asset_symbol);

CREATE TRIGGER commons_commitments_set_updated_at
  BEFORE UPDATE ON public.commons_commitments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.commons_commitments IS
  'Current Commons commitments only — value explicitly designated to move. Not Treasury holdings.';

-- ---------------------------------------------------------------------------
-- commons_allocations (history of commitment changes — NOT Circulation payouts)
-- ---------------------------------------------------------------------------
CREATE TABLE public.commons_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid REFERENCES public.treasury_assets (id) ON DELETE SET NULL,
  asset_symbol text NOT NULL,
  delta_amount numeric NOT NULL,
  reason text NOT NULL,
  related_contribution_id uuid REFERENCES public.treasury_contributions (id) ON DELETE SET NULL,
  actor_id text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT commons_allocations_asset_symbol_nonempty
    CHECK (length(trim(asset_symbol)) > 0),
  CONSTRAINT commons_allocations_delta_nonzero
    CHECK (delta_amount <> 0),
  CONSTRAINT commons_allocations_reason_nonempty
    CHECK (length(trim(reason)) > 0)
);

CREATE INDEX commons_allocations_created_at_idx
  ON public.commons_allocations (created_at DESC);

CREATE INDEX commons_allocations_asset_symbol_idx
  ON public.commons_allocations (asset_symbol, created_at DESC);

COMMENT ON TABLE public.commons_allocations IS
  'Audit history of Commons commitment deltas. Distinct from circulation_recipients.';
