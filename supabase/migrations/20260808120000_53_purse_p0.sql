-- FENN Purse Stage P0 — dedicated hot wallet config + settlement history
-- LOCAL ONLY — apply when authorised.
--
-- Purse is NOT the Treasury.
-- Private keys never enter this schema (env/KMS only).
-- Public reads: purse address + confirmed outbound transfers only.
-- No agent effects. No autonomous spending.

-- ---------------------------------------------------------------------------
-- purse_config (singleton public wallet identity)
-- ---------------------------------------------------------------------------
CREATE TABLE public.purse_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purse_wallet_address text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  notes text,
  updated_by_actor_id text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT purse_config_wallet_normalized
    CHECK (public.is_normalized_evm_address(purse_wallet_address))
);

CREATE UNIQUE INDEX purse_config_singleton_uidx
  ON public.purse_config ((true));

CREATE TRIGGER purse_config_set_updated_at
  BEFORE UPDATE ON public.purse_config
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.purse_config IS
  'THE PURSE OF FENN — dedicated hot wallet address for official FENN ERC-20. Not Treasury. No private keys. No balances stored here.';

-- ---------------------------------------------------------------------------
-- purse_transfers (settlement lifecycle + public confirmed history)
-- ---------------------------------------------------------------------------
CREATE TABLE public.purse_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Deterministic operator/idempotency key. Same key never creates two intentional sends.
  operation_id text NOT NULL,
  recipient_address text NOT NULL,
  -- Exact raw units as decimal integer string (no float).
  amount_raw text NOT NULL,
  -- Human decimal string (P0 manual is always "1").
  amount_formatted text NOT NULL,
  token_address text NOT NULL,
  chain_id integer NOT NULL,
  tx_hash text,
  status text NOT NULL DEFAULT 'pending',
  -- How failure classifies for retry law:
  --   pre_broadcast — never left the server; may retry same operation
  --   terminal      — reverted / invalid; no rebroadcast
  --   ambiguous     — broadcast maybe happened; NEVER rebroadcast
  failure_class text,
  last_error text,
  actor_id text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT purse_transfers_operation_id_nonempty
    CHECK (length(trim(operation_id)) > 0 AND length(operation_id) <= 128),
  CONSTRAINT purse_transfers_recipient_normalized
    CHECK (public.is_normalized_evm_address(recipient_address)),
  CONSTRAINT purse_transfers_token_normalized
    CHECK (public.is_normalized_evm_address(token_address)),
  CONSTRAINT purse_transfers_amount_raw_nonempty
    CHECK (length(trim(amount_raw)) > 0),
  CONSTRAINT purse_transfers_amount_formatted_nonempty
    CHECK (length(trim(amount_formatted)) > 0),
  CONSTRAINT purse_transfers_status_check
    CHECK (status IN (
      'pending',
      'submitted',
      'confirmed',
      'failed',
      'ambiguous'
    )),
  CONSTRAINT purse_transfers_failure_class_check
    CHECK (
      failure_class IS NULL
      OR failure_class IN ('pre_broadcast', 'terminal', 'ambiguous')
    ),
  CONSTRAINT purse_transfers_tx_hash_format
    CHECK (
      tx_hash IS NULL
      OR tx_hash ~ '^0x[a-fA-F0-9]{64}$'
    ),
  CONSTRAINT purse_transfers_confirmed_requires_hash
    CHECK (
      status <> 'confirmed'
      OR (tx_hash IS NOT NULL AND confirmed_at IS NOT NULL)
    ),
  CONSTRAINT purse_transfers_submitted_requires_hash
    CHECK (
      status <> 'submitted'
      OR (tx_hash IS NOT NULL AND submitted_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX purse_transfers_operation_id_uidx
  ON public.purse_transfers (operation_id);

CREATE UNIQUE INDEX purse_transfers_tx_hash_uidx
  ON public.purse_transfers (tx_hash)
  WHERE tx_hash IS NOT NULL;

CREATE INDEX purse_transfers_confirmed_history_idx
  ON public.purse_transfers (confirmed_at DESC)
  WHERE status = 'confirmed';

CREATE TRIGGER purse_transfers_set_updated_at
  BEFORE UPDATE ON public.purse_transfers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.purse_transfers IS
  'Purse settlement + public confirmed outbound history. P0: official FENN ERC-20 on Robinhood only. Clients cannot write.';

-- ---------------------------------------------------------------------------
-- Serialize Purse writes (one transfer at a time; P0 throughput)
-- Session-level advisory lock. Caller must release_purse_transfer_lock.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_acquire_purse_transfer_lock()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Fixed key for global Purse serialization (not table-oid dependent).
  RETURN pg_try_advisory_lock(87231456, 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_purse_transfer_lock()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN pg_advisory_unlock(87231456, 1);
END;
$$;

REVOKE ALL ON FUNCTION public.try_acquire_purse_transfer_lock() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_purse_transfer_lock() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.try_acquire_purse_transfer_lock() TO service_role;
GRANT EXECUTE ON FUNCTION public.release_purse_transfer_lock() TO service_role;

COMMENT ON FUNCTION public.try_acquire_purse_transfer_lock() IS
  'P0 Purse write serialization. service_role only. Prevents concurrent nonce races.';
COMMENT ON FUNCTION public.release_purse_transfer_lock() IS
  'Release P0 Purse advisory lock. service_role only.';

-- ---------------------------------------------------------------------------
-- RLS + privileges
-- ---------------------------------------------------------------------------
ALTER TABLE public.purse_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purse_transfers ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.purse_config FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.purse_transfers FROM anon, authenticated;

GRANT SELECT ON public.purse_config TO anon, authenticated;
GRANT SELECT ON public.purse_transfers TO anon, authenticated;

CREATE POLICY purse_config_public_select
  ON public.purse_config
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Confirmed settlements only — never expose pending/failed/ambiguous internals.
CREATE POLICY purse_transfers_public_confirmed_select
  ON public.purse_transfers
  FOR SELECT
  TO anon, authenticated
  USING (status = 'confirmed');

COMMENT ON POLICY purse_config_public_select ON public.purse_config IS
  'Public Purse wallet address. Writes are service-role only.';
COMMENT ON POLICY purse_transfers_public_confirmed_select ON public.purse_transfers IS
  'Public confirmed outbound Purse history only. Never pending/failed/ambiguous.';
