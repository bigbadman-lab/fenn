-- FENN Stage 2 — Migration 02: identity (profiles, outlaw applications)
-- LOCAL ONLY — do not apply until explicitly authorised.

-- ---------------------------------------------------------------------------
-- Outlaw number sequence (persistent, unique, never reused)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.outlaw_number_seq
  AS bigint
  START WITH 1
  INCREMENT BY 1
  MINVALUE 1
  NO MAXVALUE
  CACHE 1;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address text NOT NULL,
  outlaw_number bigint NOT NULL DEFAULT nextval('public.outlaw_number_seq'),
  alias text,
  joined_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  privy_user_id text,
  -- Cached from leaf_ledger (authoritative). No leaf_balance >= 0 check:
  -- accounting must allow corrections / future spending.
  leaf_balance bigint NOT NULL DEFAULT 0,
  -- Lifetime contribution cache; clawbacks that would go below zero fail the txn.
  leaf_lifetime_earned bigint NOT NULL DEFAULT 0,
  deeds_completed_count integer NOT NULL DEFAULT 0,
  greenwood_entered_at timestamptz,
  greenwood_threshold_at_entry integer,
  greenwood_lifetime_leaf_at_entry bigint,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT profiles_wallet_address_normalized
    CHECK (public.is_normalized_evm_address(wallet_address)),
  CONSTRAINT profiles_leaf_lifetime_earned_nonnegative
    CHECK (leaf_lifetime_earned >= 0),
  CONSTRAINT profiles_deeds_completed_count_nonnegative
    CHECK (deeds_completed_count >= 0),
  CONSTRAINT profiles_greenwood_snapshot_all_or_nothing
    CHECK (
      (
        greenwood_entered_at IS NULL
        AND greenwood_threshold_at_entry IS NULL
        AND greenwood_lifetime_leaf_at_entry IS NULL
      )
      OR (
        greenwood_entered_at IS NOT NULL
        AND greenwood_threshold_at_entry IS NOT NULL
        AND greenwood_lifetime_leaf_at_entry IS NOT NULL
      )
    ),
  CONSTRAINT profiles_greenwood_threshold_at_entry_nonnegative
    CHECK (
      greenwood_threshold_at_entry IS NULL
      OR greenwood_threshold_at_entry >= 0
    ),
  CONSTRAINT profiles_greenwood_lifetime_leaf_at_entry_nonnegative
    CHECK (
      greenwood_lifetime_leaf_at_entry IS NULL
      OR greenwood_lifetime_leaf_at_entry >= 0
    )
);

CREATE UNIQUE INDEX profiles_wallet_address_uidx
  ON public.profiles (wallet_address);

CREATE UNIQUE INDEX profiles_outlaw_number_uidx
  ON public.profiles (outlaw_number);

CREATE UNIQUE INDEX profiles_privy_user_id_uidx
  ON public.profiles (privy_user_id)
  WHERE privy_user_id IS NOT NULL;

CREATE INDEX profiles_greenwood_members_idx
  ON public.profiles (greenwood_entered_at)
  WHERE greenwood_entered_at IS NOT NULL;

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.profiles IS
  'Persistent Outlaw identity anchored to a normalized EVM wallet. LEAF caches are derived from leaf_ledger.';
COMMENT ON COLUMN public.profiles.leaf_balance IS
  'Cached spendable LEAF. Source of truth is leaf_ledger SUM(amount).';
COMMENT ON COLUMN public.profiles.leaf_lifetime_earned IS
  'Cached lifetime LEAF. Source of truth is leaf_ledger SUM(lifetime_delta).';
COMMENT ON COLUMN public.profiles.greenwood_entered_at IS
  'Persistent Greenwood admission timestamp. Membership is this field, not current LEAF.';

-- ---------------------------------------------------------------------------
-- outlaw_applications (one per profile for MVP)
-- ---------------------------------------------------------------------------
CREATE TABLE public.outlaw_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  chosen_name text NOT NULL,
  x_handle text,
  why_statement text NOT NULL,
  contribution_type text NOT NULL,
  vow_accepted boolean NOT NULL,
  terms_version text NOT NULL,
  review_status text NOT NULL DEFAULT 'accepted',
  review_message text,
  submitted_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  raw_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT outlaw_applications_review_status_check
    CHECK (review_status IN ('pending', 'accepted', 'rejected')),
  CONSTRAINT outlaw_applications_contribution_type_nonempty
    CHECK (length(trim(contribution_type)) > 0),
  CONSTRAINT outlaw_applications_chosen_name_nonempty
    CHECK (length(trim(chosen_name)) > 0),
  CONSTRAINT outlaw_applications_why_statement_nonempty
    CHECK (length(trim(why_statement)) > 0)
);

CREATE UNIQUE INDEX outlaw_applications_profile_id_uidx
  ON public.outlaw_applications (profile_id);

CREATE INDEX outlaw_applications_submitted_at_idx
  ON public.outlaw_applications (submitted_at DESC);

CREATE TRIGGER outlaw_applications_set_updated_at
  BEFORE UPDATE ON public.outlaw_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.outlaw_applications IS
  'Outlaw Register application ritual. Exactly one row per profile for MVP.';
