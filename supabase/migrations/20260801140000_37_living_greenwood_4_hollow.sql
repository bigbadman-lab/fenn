-- FENN — Living Greenwood 4: The Hollow + reward campaigns
-- LOCAL ONLY — do not apply until explicitly authorised.
--
-- Private Greenwood reward inbox. Gathering open-hand snapshots feed campaigns.
-- LEAF claims use ledger source_type = hollow. No automatic on-chain transfers.

-- ---------------------------------------------------------------------------
-- LEAF ledger: add hollow source type
-- ---------------------------------------------------------------------------
ALTER TABLE public.leaf_ledger
  DROP CONSTRAINT leaf_ledger_source_type_check;

ALTER TABLE public.leaf_ledger
  ADD CONSTRAINT leaf_ledger_source_type_check
  CHECK (
    source_type IN (
      'camp',
      'deed',
      'admin_adjustment',
      'system',
      'hollow'
    )
  );

-- ---------------------------------------------------------------------------
-- greenwood_reward_campaigns
-- ---------------------------------------------------------------------------
CREATE TABLE public.greenwood_reward_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  reason text NOT NULL DEFAULT '',
  reward_type text NOT NULL,
  amount_per_recipient numeric,
  asset_chain_id integer,
  asset_contract_address text,
  asset_symbol text,
  recipient_rule text NOT NULL,
  gathering_id uuid REFERENCES public.greenwood_gatherings (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft',
  recipient_count integer NOT NULL DEFAULT 0,
  total_amount numeric,
  resolved_at timestamptz,
  executed_at timestamptz,
  cancelled_at timestamptz,
  created_by_actor_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT greenwood_reward_campaigns_title_nonempty
    CHECK (length(trim(title)) > 0),
  CONSTRAINT greenwood_reward_campaigns_reward_type_check
    CHECK (reward_type IN ('leaf', 'eth', 'erc20', 'informational')),
  CONSTRAINT greenwood_reward_campaigns_recipient_rule_check
    CHECK (recipient_rule IN ('manual_profiles', 'gathering_open_hands')),
  CONSTRAINT greenwood_reward_campaigns_status_check
    CHECK (
      status IN (
        'draft',
        'resolved',
        'available',
        'executing',
        'completed',
        'completed_partial',
        'cancelled'
      )
    ),
  CONSTRAINT greenwood_reward_campaigns_created_by_nonempty
    CHECK (length(trim(created_by_actor_id)) > 0),
  CONSTRAINT greenwood_reward_campaigns_recipient_count_nonneg
    CHECK (recipient_count >= 0),
  CONSTRAINT greenwood_reward_campaigns_gathering_rule
    CHECK (
      (recipient_rule = 'gathering_open_hands' AND gathering_id IS NOT NULL)
      OR (recipient_rule = 'manual_profiles')
    ),
  CONSTRAINT greenwood_reward_campaigns_leaf_amount
    CHECK (
      reward_type <> 'leaf'
      OR (amount_per_recipient IS NOT NULL AND amount_per_recipient > 0)
    ),
  CONSTRAINT greenwood_reward_campaigns_onchain_amount
    CHECK (
      reward_type NOT IN ('eth', 'erc20')
      OR (amount_per_recipient IS NOT NULL AND amount_per_recipient > 0)
    ),
  CONSTRAINT greenwood_reward_campaigns_cancelled_consistent
    CHECK (
      (status <> 'cancelled' AND cancelled_at IS NULL)
      OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
    )
);

CREATE INDEX greenwood_reward_campaigns_status_idx
  ON public.greenwood_reward_campaigns (status, created_at DESC);

CREATE INDEX greenwood_reward_campaigns_gathering_idx
  ON public.greenwood_reward_campaigns (gathering_id)
  WHERE gathering_id IS NOT NULL;

CREATE TRIGGER greenwood_reward_campaigns_set_updated_at
  BEFORE UPDATE ON public.greenwood_reward_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.greenwood_reward_campaigns IS
  'Greenwood reward campaigns. Recipients freeze at resolve. No auto treasury signing.';

-- ---------------------------------------------------------------------------
-- greenwood_reward_campaign_recipients (frozen snapshot)
-- ---------------------------------------------------------------------------
CREATE TABLE public.greenwood_reward_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.greenwood_reward_campaigns (id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  wallet_address_snapshot text,
  eligibility_source text NOT NULL,
  eligibility_source_id text,
  resolved_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  status text NOT NULL DEFAULT 'pending',
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT greenwood_reward_campaign_recipients_uidx
    UNIQUE (campaign_id, profile_id),
  CONSTRAINT greenwood_reward_campaign_recipients_source_check
    CHECK (
      eligibility_source IN (
        'manual_profile',
        'gathering_open_hand'
      )
    ),
  CONSTRAINT greenwood_reward_campaign_recipients_status_check
    CHECK (
      status IN (
        'pending',
        'ready',
        'fulfilled',
        'failed',
        'cancelled'
      )
    ),
  CONSTRAINT greenwood_reward_campaign_recipients_wallet_normalized
    CHECK (
      wallet_address_snapshot IS NULL
      OR public.is_normalized_evm_address(wallet_address_snapshot)
    )
);

CREATE INDEX greenwood_reward_campaign_recipients_profile_idx
  ON public.greenwood_reward_campaign_recipients (profile_id);

CREATE TRIGGER greenwood_reward_campaign_recipients_set_updated_at
  BEFORE UPDATE ON public.greenwood_reward_campaign_recipients
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.greenwood_reward_campaign_recipients IS
  'Frozen campaign recipients. Wallet snapshots do not follow later profile wallet changes.';

-- ---------------------------------------------------------------------------
-- greenwood_hollow_rewards
-- ---------------------------------------------------------------------------
CREATE TABLE public.greenwood_hollow_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES public.greenwood_reward_campaigns (id) ON DELETE RESTRICT,
  campaign_recipient_id uuid REFERENCES public.greenwood_reward_campaign_recipients (id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  reward_type text NOT NULL,
  title text NOT NULL,
  reason text NOT NULL DEFAULT '',
  amount numeric,
  asset_chain_id integer,
  asset_contract_address text,
  asset_symbol text,
  wallet_address_snapshot text,
  status text NOT NULL,
  available_at timestamptz,
  expires_at timestamptz,
  claimed_at timestamptz,
  sent_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  transaction_hash text,
  leaf_ledger_entry_id uuid REFERENCES public.leaf_ledger (id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT greenwood_hollow_rewards_title_nonempty
    CHECK (length(trim(title)) > 0),
  CONSTRAINT greenwood_hollow_rewards_reward_type_check
    CHECK (reward_type IN ('leaf', 'eth', 'erc20', 'informational')),
  CONSTRAINT greenwood_hollow_rewards_status_check
    CHECK (
      status IN (
        'draft',
        'available',
        'claimed',
        'expired',
        'cancelled',
        'failed',
        'awaiting_send',
        'sent',
        'confirmed',
        'acknowledged'
      )
    ),
  CONSTRAINT greenwood_hollow_rewards_idempotency_uidx
    UNIQUE (idempotency_key),
  CONSTRAINT greenwood_hollow_rewards_campaign_recipient_uidx
    UNIQUE (campaign_recipient_id),
  CONSTRAINT greenwood_hollow_rewards_wallet_normalized
    CHECK (
      wallet_address_snapshot IS NULL
      OR public.is_normalized_evm_address(wallet_address_snapshot)
    ),
  CONSTRAINT greenwood_hollow_rewards_sent_requires_tx
    CHECK (
      status NOT IN ('sent', 'confirmed')
      OR (
        transaction_hash IS NOT NULL
        AND length(trim(transaction_hash)) > 0
      )
    )
);

CREATE INDEX greenwood_hollow_rewards_profile_status_idx
  ON public.greenwood_hollow_rewards (profile_id, status, available_at DESC);

CREATE INDEX greenwood_hollow_rewards_campaign_idx
  ON public.greenwood_hollow_rewards (campaign_id)
  WHERE campaign_id IS NOT NULL;

CREATE TRIGGER greenwood_hollow_rewards_set_updated_at
  BEFORE UPDATE ON public.greenwood_hollow_rewards
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.greenwood_hollow_rewards IS
  'Private Hollow items. LEAF claims use source_type hollow. Sent requires transaction_hash.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.greenwood_reward_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.greenwood_reward_campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.greenwood_hollow_rewards ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.greenwood_reward_campaigns FROM anon, authenticated;
REVOKE ALL ON public.greenwood_reward_campaign_recipients FROM anon, authenticated;
REVOKE ALL ON public.greenwood_hollow_rewards FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- claim_greenwood_hollow_leaf — transactional LEAF claim
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_greenwood_hollow_leaf(
  p_reward_id uuid,
  p_profile_id uuid
)
RETURNS TABLE (
  reward_id uuid,
  status text,
  claimed_at timestamptz,
  leaf_ledger_entry_id uuid,
  newly_claimed boolean,
  leaf_balance bigint,
  leaf_lifetime_earned bigint,
  amount bigint
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_member timestamptz;
  v_reward public.greenwood_hollow_rewards%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_now timestamptz := timezone('utc', now());
  v_key text;
  v_existing_ledger public.leaf_ledger%ROWTYPE;
  v_ledger public.leaf_ledger%ROWTYPE;
  v_amount bigint;
  v_newly boolean := false;
BEGIN
  IF p_reward_id IS NULL OR p_profile_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: reward_id and profile_id required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(87201440, hashtext(p_reward_id::text));

  SELECT p.greenwood_entered_at
  INTO v_member
  FROM public.profiles p
  WHERE p.id = p_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_PROFILE_NOT_FOUND: profile missing'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_member IS NULL THEN
    RAISE EXCEPTION 'FENN_GREENWOOD_MEMBERSHIP_REQUIRED: profile is not a Greenwood member'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT r.*
  INTO v_reward
  FROM public.greenwood_hollow_rewards r
  WHERE r.id = p_reward_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_HOLLOW_NOT_FOUND: reward missing'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_reward.profile_id IS DISTINCT FROM p_profile_id THEN
    RAISE EXCEPTION 'FENN_HOLLOW_FORBIDDEN: reward belongs to another profile'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_reward.reward_type IS DISTINCT FROM 'leaf' THEN
    RAISE EXCEPTION 'FENN_HOLLOW_NOT_LEAF: only LEAF rewards can be claimed here'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_reward.status = 'claimed' AND v_reward.leaf_ledger_entry_id IS NOT NULL THEN
    SELECT *
    INTO v_profile
    FROM public.profiles p
    WHERE p.id = p_profile_id;

    SELECT *
    INTO v_existing_ledger
    FROM public.leaf_ledger l
    WHERE l.id = v_reward.leaf_ledger_entry_id;

    RETURN QUERY
    SELECT
      v_reward.id,
      v_reward.status,
      v_reward.claimed_at,
      v_reward.leaf_ledger_entry_id,
      false,
      v_profile.leaf_balance,
      v_profile.leaf_lifetime_earned,
      CASE
        WHEN v_existing_ledger.id IS NOT NULL THEN v_existing_ledger.amount
        ELSE COALESCE(v_reward.amount, 0)::bigint
      END;
    RETURN;
  END IF;

  IF v_reward.status = 'cancelled' OR v_reward.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'FENN_HOLLOW_CANCELLED: reward cancelled'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_reward.status = 'expired'
     OR (v_reward.expires_at IS NOT NULL AND v_now >= v_reward.expires_at) THEN
    IF v_reward.status IS DISTINCT FROM 'expired' THEN
      UPDATE public.greenwood_hollow_rewards AS h
      SET status = 'expired'
      WHERE h.id = v_reward.id;
    END IF;
    RAISE EXCEPTION 'FENN_HOLLOW_EXPIRED: reward expired'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_reward.status IS DISTINCT FROM 'available' THEN
    RAISE EXCEPTION 'FENN_HOLLOW_NOT_AVAILABLE: reward is not available'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_reward.amount IS NULL OR v_reward.amount <= 0
     OR trunc(v_reward.amount) <> v_reward.amount THEN
    RAISE EXCEPTION 'FENN_HOLLOW_INVALID_AMOUNT: LEAF amount must be a positive integer'
      USING ERRCODE = '22023';
  END IF;

  v_amount := v_reward.amount::bigint;
  v_key := 'hollow_reward:' || v_reward.id::text || ':claim';

  SELECT *
  INTO v_existing_ledger
  FROM public.leaf_ledger l
  WHERE l.idempotency_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.greenwood_hollow_rewards AS h
    SET
      status = 'claimed',
      claimed_at = COALESCE(h.claimed_at, v_existing_ledger.created_at),
      leaf_ledger_entry_id = v_existing_ledger.id
    WHERE h.id = v_reward.id
    RETURNING h.* INTO v_reward;

    SELECT *
    INTO v_profile
    FROM public.profiles p
    WHERE p.id = p_profile_id;

    RETURN QUERY
    SELECT
      v_reward.id,
      v_reward.status,
      v_reward.claimed_at,
      v_reward.leaf_ledger_entry_id,
      false,
      v_profile.leaf_balance,
      v_profile.leaf_lifetime_earned,
      v_existing_ledger.amount;
    RETURN;
  END IF;

  SELECT *
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = p_profile_id
  FOR UPDATE;

  INSERT INTO public.leaf_ledger (
    profile_id,
    wallet_address,
    amount,
    lifetime_delta,
    source_type,
    source_id,
    secondary_source_id,
    reason,
    actor_type,
    actor_id,
    idempotency_key,
    metadata
  )
  VALUES (
    p_profile_id,
    v_profile.wallet_address,
    v_amount,
    v_amount,
    'hollow',
    v_reward.id::text,
    v_reward.campaign_id::text,
    COALESCE(NULLIF(trim(v_reward.reason), ''), v_reward.title),
    'system',
    'greenwood.hollow.claim',
    v_key,
    jsonb_build_object(
      'hollow_reward_id', v_reward.id,
      'campaign_id', v_reward.campaign_id
    )
  )
  RETURNING * INTO v_ledger;

  v_newly := true;

  UPDATE public.greenwood_hollow_rewards AS h
  SET
    status = 'claimed',
    claimed_at = v_now,
    leaf_ledger_entry_id = v_ledger.id
  WHERE h.id = v_reward.id
  RETURNING h.* INTO v_reward;

  IF v_reward.campaign_recipient_id IS NOT NULL THEN
    UPDATE public.greenwood_reward_campaign_recipients AS cr
    SET status = 'fulfilled'
    WHERE cr.id = v_reward.campaign_recipient_id;
  END IF;

  SELECT *
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = p_profile_id;

  RETURN QUERY
  SELECT
    v_reward.id,
    v_reward.status,
    v_reward.claimed_at,
    v_reward.leaf_ledger_entry_id,
    v_newly,
    v_profile.leaf_balance,
    v_profile.leaf_lifetime_earned,
    v_ledger.amount;
END;
$$;

COMMENT ON FUNCTION public.claim_greenwood_hollow_leaf(uuid, uuid) IS
  'Atomic Hollow LEAF claim. Inserts leaf_ledger source_type=hollow and marks reward claimed.';

REVOKE ALL ON FUNCTION public.claim_greenwood_hollow_leaf(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_greenwood_hollow_leaf(uuid, uuid) TO service_role;
