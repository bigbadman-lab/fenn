-- FENN P2C launch — one-shot Treasury → Purse funding durability
-- LOCAL ONLY — apply when authorised.
--
-- Records the singular launch funding ceremony (10,000,000 FENN).
-- Not purse_transfers (those are Purse outbound only).
-- No private keys. No live balances.

CREATE TABLE public.fenn_launch_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Fixed identity for this ceremony (e.g. fenn_launch_purse_funding_v1).
  operation_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  chain_id integer NOT NULL,
  token_contract text NOT NULL,
  treasury_address text NOT NULL,
  purse_address text NOT NULL,
  -- Exact raw ERC-20 units as decimal integer string (no float).
  amount_raw text NOT NULL,
  decimals integer NOT NULL,
  -- Human decimal string, e.g. "10000000".
  amount_formatted text NOT NULL,
  tx_hash text,
  block_number bigint,
  failure_class text,
  last_error text,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT fenn_launch_operations_operation_id_nonempty
    CHECK (length(trim(operation_id)) > 0 AND length(operation_id) <= 128),
  CONSTRAINT fenn_launch_operations_token_normalized
    CHECK (public.is_normalized_evm_address(token_contract)),
  CONSTRAINT fenn_launch_operations_treasury_normalized
    CHECK (public.is_normalized_evm_address(treasury_address)),
  CONSTRAINT fenn_launch_operations_purse_normalized
    CHECK (public.is_normalized_evm_address(purse_address)),
  CONSTRAINT fenn_launch_operations_amount_raw_nonempty
    CHECK (length(trim(amount_raw)) > 0),
  CONSTRAINT fenn_launch_operations_amount_formatted_nonempty
    CHECK (length(trim(amount_formatted)) > 0),
  CONSTRAINT fenn_launch_operations_decimals_check
    CHECK (decimals >= 0 AND decimals <= 255),
  CONSTRAINT fenn_launch_operations_status_check
    CHECK (status IN (
      'pending',
      'submitted',
      'confirmed',
      'failed',
      'ambiguous'
    )),
  CONSTRAINT fenn_launch_operations_failure_class_check
    CHECK (
      failure_class IS NULL
      OR failure_class IN ('pre_broadcast', 'terminal', 'ambiguous')
    ),
  CONSTRAINT fenn_launch_operations_tx_hash_format
    CHECK (
      tx_hash IS NULL
      OR tx_hash ~ '^0x[a-fA-F0-9]{64}$'
    ),
  CONSTRAINT fenn_launch_operations_confirmed_requires_hash
    CHECK (
      status <> 'confirmed'
      OR (tx_hash IS NOT NULL AND confirmed_at IS NOT NULL)
    ),
  CONSTRAINT fenn_launch_operations_submitted_requires_hash
    CHECK (
      status <> 'submitted'
      OR (tx_hash IS NOT NULL AND submitted_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX fenn_launch_operations_operation_id_uidx
  ON public.fenn_launch_operations (operation_id);

CREATE UNIQUE INDEX fenn_launch_operations_tx_hash_uidx
  ON public.fenn_launch_operations (tx_hash)
  WHERE tx_hash IS NOT NULL;

CREATE TRIGGER fenn_launch_operations_set_updated_at
  BEFORE UPDATE ON public.fenn_launch_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.fenn_launch_operations IS
  'One-shot FENN launch ceremonies (e.g. Treasury → Purse 10m funding). Not live balances. No private keys. service_role only.';

ALTER TABLE public.fenn_launch_operations ENABLE ROW LEVEL SECURITY;

-- Service role / admin only. No browser writes or public selects.
REVOKE ALL ON TABLE public.fenn_launch_operations FROM PUBLIC;
REVOKE ALL ON TABLE public.fenn_launch_operations FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.fenn_launch_operations TO service_role;
