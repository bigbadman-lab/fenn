-- FENN Purse P0 pre-launch test rail isolation
-- LOCAL ONLY — apply when authorised.
--
-- Adds is_test to distinguish disposable-token test settlements from
-- production official-FENN settlements. Public history excludes test rows.
-- Does NOT introduce official test tokens into treasury_assets.

ALTER TABLE public.purse_transfers
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.purse_transfers.is_test IS
  'True only for pre-launch disposable ERC-20 test settlements. Never public THE PURSE history. Official FENN transfers remain false.';

-- Prefer partial index for public confirmed production history.
DROP INDEX IF EXISTS public.purse_transfers_confirmed_history_idx;
CREATE INDEX purse_transfers_confirmed_history_idx
  ON public.purse_transfers (confirmed_at DESC)
  WHERE status = 'confirmed' AND is_test = false;

CREATE INDEX IF NOT EXISTS purse_transfers_is_test_confirmed_idx
  ON public.purse_transfers (confirmed_at DESC)
  WHERE status = 'confirmed' AND is_test = true;

-- Public SELECT: confirmed non-test only (service_role bypasses RLS).
DROP POLICY IF EXISTS purse_transfers_public_confirmed_select ON public.purse_transfers;

CREATE POLICY purse_transfers_public_confirmed_select
  ON public.purse_transfers
  FOR SELECT
  TO anon, authenticated
  USING (status = 'confirmed' AND is_test = false);

COMMENT ON POLICY purse_transfers_public_confirmed_select ON public.purse_transfers IS
  'Public confirmed official-FENN Purse history only. is_test settlements never public.';
