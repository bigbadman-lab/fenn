-- FENN Stage 2 — Migration 08: Circulations
-- LOCAL ONLY — do not apply until explicitly authorised.
-- Manual execution only — no on-chain automation.

-- ---------------------------------------------------------------------------
-- circulations
-- ---------------------------------------------------------------------------
CREATE TABLE public.circulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  title text,
  basis text NOT NULL,
  asset_symbol text,
  asset_id uuid REFERENCES public.treasury_assets (id) ON DELETE SET NULL,
  total_amount numeric,
  recipient_count integer NOT NULL DEFAULT 0,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  announced_at timestamptz,
  executed_at timestamptz,
  completed_at timestamptz,
  tx_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  export_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT circulations_code_nonempty
    CHECK (length(trim(code)) > 0),
  CONSTRAINT circulations_status_check
    CHECK (status IN ('draft', 'planned', 'executing', 'completed', 'cancelled')),
  CONSTRAINT circulations_basis_nonempty
    CHECK (length(trim(basis)) > 0),
  CONSTRAINT circulations_recipient_count_nonnegative
    CHECK (recipient_count >= 0),
  CONSTRAINT circulations_total_amount_nonnegative
    CHECK (total_amount IS NULL OR total_amount >= 0)
);

CREATE UNIQUE INDEX circulations_code_uidx
  ON public.circulations (code);

CREATE INDEX circulations_status_completed_idx
  ON public.circulations (status, completed_at DESC NULLS LAST);

CREATE TRIGGER circulations_set_updated_at
  BEFORE UPDATE ON public.circulations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.circulations IS
  'Manual Circulation events. Completed rows form the public Ledger history.';

-- ---------------------------------------------------------------------------
-- circulation_recipients
-- ---------------------------------------------------------------------------
CREATE TABLE public.circulation_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circulation_id uuid NOT NULL REFERENCES public.circulations (id) ON DELETE RESTRICT,
  profile_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  wallet_address text NOT NULL,
  amount numeric NOT NULL,
  basis_note text,
  paid boolean NOT NULL DEFAULT false,
  tx_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT circulation_recipients_wallet_normalized
    CHECK (public.is_normalized_evm_address(wallet_address)),
  CONSTRAINT circulation_recipients_amount_positive
    CHECK (amount > 0)
);

CREATE UNIQUE INDEX circulation_recipients_circulation_wallet_uidx
  ON public.circulation_recipients (circulation_id, wallet_address);

CREATE INDEX circulation_recipients_circulation_idx
  ON public.circulation_recipients (circulation_id);

CREATE INDEX circulation_recipients_wallet_idx
  ON public.circulation_recipients (wallet_address);

CREATE TRIGGER circulation_recipients_set_updated_at
  BEFORE UPDATE ON public.circulation_recipients
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.circulation_recipients IS
  'Per-wallet Circulation allocations for export and completion recording.';
