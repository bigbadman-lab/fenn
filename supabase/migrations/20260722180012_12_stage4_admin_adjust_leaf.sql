-- FENN Stage 4 — Additive: atomic admin LEAF adjustment + audit
-- LOCAL ONLY — do not apply until explicitly authorised.
-- Does not modify Stage 2 or Stage 3 migration files.

-- ---------------------------------------------------------------------------
-- public.admin_adjust_leaf
-- Trusted server/service-role path only. Does NOT authenticate admins.
-- Caller (Next.js) must authorize the admin principal before invoking.
-- SECURITY INVOKER: runs with privileges of the invoking role (service_role).
-- Single function call = one PostgreSQL transaction (all-or-nothing).
-- Idempotent on p_idempotency_key: returns existing ledger, no second audit.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_adjust_leaf(
  p_profile_id uuid,
  p_amount bigint,
  p_lifetime_delta bigint,
  p_reason text,
  p_actor_id text,
  p_idempotency_key text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_source_id text DEFAULT NULL,
  p_secondary_source_id text DEFAULT NULL
)
RETURNS TABLE (
  created boolean,
  ledger_id uuid,
  profile_id uuid,
  amount bigint,
  lifetime_delta bigint,
  source_type text,
  source_id text,
  reason text,
  created_at timestamptz,
  leaf_balance bigint,
  leaf_lifetime_earned bigint
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_reason text;
  v_actor text;
  v_key text;
  v_metadata jsonb;
  v_source text;
  v_secondary text;
  v_profile public.profiles%ROWTYPE;
  v_existing public.leaf_ledger%ROWTYPE;
  v_ledger public.leaf_ledger%ROWTYPE;
  v_next_lifetime bigint;
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: profile_id required'
      USING ERRCODE = '22023';
  END IF;

  IF p_amount IS NULL OR p_amount = 0 THEN
    RAISE EXCEPTION 'FENN_VALIDATION: amount must be non-zero'
      USING ERRCODE = '22023';
  END IF;

  IF p_lifetime_delta IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: lifetime_delta required'
      USING ERRCODE = '22023';
  END IF;

  v_reason := trim(p_reason);
  IF v_reason IS NULL OR length(v_reason) = 0 THEN
    RAISE EXCEPTION 'FENN_VALIDATION: reason required'
      USING ERRCODE = '22023';
  END IF;

  v_actor := trim(p_actor_id);
  IF v_actor IS NULL OR length(v_actor) = 0 THEN
    RAISE EXCEPTION 'FENN_VALIDATION: actor_id required'
      USING ERRCODE = '22023';
  END IF;

  v_key := trim(p_idempotency_key);
  IF v_key IS NULL OR length(v_key) = 0 THEN
    RAISE EXCEPTION 'FENN_VALIDATION: idempotency_key required'
      USING ERRCODE = '22023';
  END IF;

  v_metadata := COALESCE(p_metadata, '{}'::jsonb);
  v_source := NULLIF(trim(COALESCE(p_source_id, '')), '');
  v_secondary := NULLIF(trim(COALESCE(p_secondary_source_id, '')), '');

  -- Serialize concurrent adjustments for the same idempotency key / profile.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 2));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_profile_id::text, 3));

  -- Idempotent retry: return existing ledger, do not insert a second audit.
  SELECT *
  INTO v_existing
  FROM public.leaf_ledger l
  WHERE l.idempotency_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.profile_id IS DISTINCT FROM p_profile_id THEN
      RAISE EXCEPTION
        'FENN_IDEMPOTENCY_CONFLICT: key already used for a different profile'
        USING ERRCODE = '23505';
    END IF;

    SELECT *
    INTO v_profile
    FROM public.profiles p
    WHERE p.id = p_profile_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'FENN_PROFILE_NOT_FOUND: profile missing'
        USING ERRCODE = 'P0002';
    END IF;

    created := false;
    ledger_id := v_existing.id;
    profile_id := v_existing.profile_id;
    amount := v_existing.amount;
    lifetime_delta := v_existing.lifetime_delta;
    source_type := v_existing.source_type;
    source_id := v_existing.source_id;
    reason := v_existing.reason;
    created_at := v_existing.created_at;
    leaf_balance := v_profile.leaf_balance;
    leaf_lifetime_earned := v_profile.leaf_lifetime_earned;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT *
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = p_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_PROFILE_NOT_FOUND: profile missing'
      USING ERRCODE = 'P0002';
  END IF;

  v_next_lifetime := v_profile.leaf_lifetime_earned + p_lifetime_delta;
  IF v_next_lifetime < 0 THEN
    RAISE EXCEPTION
      'FENN_VALIDATION: lifetime_delta would make lifetime negative'
      USING ERRCODE = '22023';
  END IF;

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
    p_amount,
    p_lifetime_delta,
    'admin_adjustment',
    v_source,
    v_secondary,
    v_reason,
    'admin',
    v_actor,
    v_key,
    v_metadata
  )
  RETURNING * INTO v_ledger;

  -- Cache trigger has already updated profile; reload.
  SELECT *
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = p_profile_id;

  INSERT INTO public.admin_audit_log (
    actor_id,
    actor_type,
    action,
    entity_type,
    entity_id,
    before_state,
    after_state,
    reason
  )
  VALUES (
    v_actor,
    'admin',
    'leaf.adjust',
    'leaf_ledger',
    v_ledger.id::text,
    jsonb_build_object(
      'profile_id', p_profile_id,
      'leaf_balance', v_profile.leaf_balance - p_amount,
      'leaf_lifetime_earned', v_profile.leaf_lifetime_earned - p_lifetime_delta
    ),
    jsonb_build_object(
      'ledger_id', v_ledger.id,
      'amount', p_amount,
      'lifetime_delta', p_lifetime_delta,
      'leaf_balance', v_profile.leaf_balance,
      'leaf_lifetime_earned', v_profile.leaf_lifetime_earned,
      'idempotency_key', v_key
    ),
    v_reason
  );

  created := true;
  ledger_id := v_ledger.id;
  profile_id := v_ledger.profile_id;
  amount := v_ledger.amount;
  lifetime_delta := v_ledger.lifetime_delta;
  source_type := v_ledger.source_type;
  source_id := v_ledger.source_id;
  reason := v_ledger.reason;
  created_at := v_ledger.created_at;
  leaf_balance := v_profile.leaf_balance;
  leaf_lifetime_earned := v_profile.leaf_lifetime_earned;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.admin_adjust_leaf(
  uuid, bigint, bigint, text, text, text, jsonb, text, text
) IS
  'Atomic admin LEAF adjustment + admin_audit_log. service_role only. Idempotent on idempotency_key.';

REVOKE ALL ON FUNCTION public.admin_adjust_leaf(
  uuid, bigint, bigint, text, text, text, jsonb, text, text
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.admin_adjust_leaf(
  uuid, bigint, bigint, text, text, text, jsonb, text, text
) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_adjust_leaf(
  uuid, bigint, bigint, text, text, text, jsonb, text, text
) TO service_role;
