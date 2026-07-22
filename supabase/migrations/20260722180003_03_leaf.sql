-- FENN Stage 2 — Migration 03: LEAF ledger (authoritative) + profile cache sync
-- LOCAL ONLY — do not apply until explicitly authorised.

-- ---------------------------------------------------------------------------
-- leaf_ledger
-- ---------------------------------------------------------------------------
CREATE TABLE public.leaf_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  -- Wallet snapshot at earning/mutation time (normalized).
  wallet_address text NOT NULL,
  -- Signed delta to current spendable balance.
  amount bigint NOT NULL,
  -- Delta to lifetime contribution total (normally = amount for earns; 0 for spends).
  lifetime_delta bigint NOT NULL,
  source_type text NOT NULL,
  source_id text,
  secondary_source_id text,
  reason text NOT NULL,
  actor_type text NOT NULL,
  actor_id text,
  idempotency_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT leaf_ledger_amount_nonzero
    CHECK (amount <> 0),
  CONSTRAINT leaf_ledger_wallet_address_normalized
    CHECK (public.is_normalized_evm_address(wallet_address)),
  CONSTRAINT leaf_ledger_source_type_check
    CHECK (source_type IN ('camp', 'deed', 'admin_adjustment', 'system')),
  CONSTRAINT leaf_ledger_actor_type_check
    CHECK (actor_type IN ('system', 'admin', 'service')),
  CONSTRAINT leaf_ledger_reason_nonempty
    CHECK (length(trim(reason)) > 0)
);

CREATE UNIQUE INDEX leaf_ledger_idempotency_key_uidx
  ON public.leaf_ledger (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX leaf_ledger_profile_created_at_idx
  ON public.leaf_ledger (profile_id, created_at DESC);

CREATE INDEX leaf_ledger_source_idx
  ON public.leaf_ledger (source_type, source_id);

CREATE INDEX leaf_ledger_wallet_address_idx
  ON public.leaf_ledger (wallet_address);

CREATE INDEX leaf_ledger_created_at_idx
  ON public.leaf_ledger (created_at DESC);

COMMENT ON TABLE public.leaf_ledger IS
  'Authoritative off-chain LEAF accounting. Append-only; corrections are new rows.';
COMMENT ON COLUMN public.leaf_ledger.amount IS
  'Signed change to current spendable LEAF balance.';
COMMENT ON COLUMN public.leaf_ledger.lifetime_delta IS
  'Change to lifetime earned. Normal earn: = amount. Spend: 0. Fraud clawback may be negative.';

-- ---------------------------------------------------------------------------
-- Atomic profile cache sync on INSERT
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_leaf_ledger_to_profile_cache()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  updated_rows integer;
BEGIN
  UPDATE public.profiles
  SET
    leaf_balance = leaf_balance + NEW.amount,
    leaf_lifetime_earned = leaf_lifetime_earned + NEW.lifetime_delta,
    updated_at = timezone('utc', now())
  WHERE id = NEW.profile_id;

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  IF updated_rows <> 1 THEN
    RAISE EXCEPTION
      'leaf_ledger insert failed: profile % does not exist',
      NEW.profile_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER leaf_ledger_apply_profile_cache
  AFTER INSERT ON public.leaf_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_leaf_ledger_to_profile_cache();

COMMENT ON FUNCTION public.apply_leaf_ledger_to_profile_cache() IS
  'Atomically updates profiles LEAF caches when a leaf_ledger row is inserted.';

-- ---------------------------------------------------------------------------
-- Immutability: block UPDATE / DELETE (corrections must be new rows)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_leaf_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'leaf_ledger is immutable; corrections must be inserted as new rows';
END;
$$;

CREATE TRIGGER leaf_ledger_prevent_update
  BEFORE UPDATE ON public.leaf_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_leaf_ledger_mutation();

CREATE TRIGGER leaf_ledger_prevent_delete
  BEFORE DELETE ON public.leaf_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_leaf_ledger_mutation();

COMMENT ON FUNCTION public.prevent_leaf_ledger_mutation() IS
  'Rejects UPDATE/DELETE on leaf_ledger to preserve auditable history.';
