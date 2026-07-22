-- FENN Stage 3 — Additive: atomic Outlaw registration
-- LOCAL ONLY until manually applied in Supabase SQL Editor.
-- Does not modify Stage 2 migration files.

-- ---------------------------------------------------------------------------
-- public.register_outlaw
-- Trusted server/service-role path only. Does NOT verify Privy tokens.
-- Caller must already validate Privy identity + wallet ownership.
-- SECURITY INVOKER: runs with privileges of the invoking role (service_role).
-- A single function call is one PostgreSQL transaction (all-or-nothing).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.register_outlaw(
  p_privy_user_id text,
  p_wallet_address text,
  p_chosen_name text,
  p_x_handle text,
  p_why_statement text,
  p_contribution_type text,
  p_vow_accepted boolean,
  p_terms_version text,
  p_raw_answers jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  created boolean,
  profile_id uuid,
  outlaw_number bigint,
  alias text,
  wallet_address text,
  privy_user_id text,
  joined_at timestamptz,
  leaf_balance bigint,
  leaf_lifetime_earned bigint,
  deeds_completed_count integer,
  greenwood_entered_at timestamptz,
  application_id uuid,
  review_status text,
  submitted_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_privy text;
  v_wallet text;
  v_name text;
  v_why text;
  v_contribution text;
  v_terms text;
  v_x text;
  v_raw jsonb;
  v_profile public.profiles%ROWTYPE;
  v_application public.outlaw_applications%ROWTYPE;
  v_created boolean := false;
BEGIN
  v_privy := trim(p_privy_user_id);
  IF v_privy IS NULL OR length(v_privy) = 0 THEN
    RAISE EXCEPTION 'FENN_VALIDATION: privy_user_id required'
      USING ERRCODE = '22023';
  END IF;

  IF p_vow_accepted IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'FENN_VALIDATION: vow_accepted must be true'
      USING ERRCODE = '22023';
  END IF;

  v_wallet := lower(trim(p_wallet_address));
  IF NOT public.is_normalized_evm_address(v_wallet) THEN
    RAISE EXCEPTION 'FENN_VALIDATION: invalid wallet_address'
      USING ERRCODE = '22023';
  END IF;

  v_name := trim(p_chosen_name);
  v_why := trim(p_why_statement);
  v_contribution := trim(p_contribution_type);
  v_terms := trim(p_terms_version);
  v_x := NULLIF(trim(COALESCE(p_x_handle, '')), '');
  v_raw := COALESCE(p_raw_answers, '{}'::jsonb);

  IF length(v_name) = 0 OR length(v_why) = 0
     OR length(v_contribution) = 0 OR length(v_terms) = 0 THEN
    RAISE EXCEPTION 'FENN_VALIDATION: required registration fields missing'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize concurrent registrations on the same wallet / privy identity.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_wallet, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_privy, 1));

  -- CASE A: existing profile by privy_user_id
  SELECT *
  INTO v_profile
  FROM public.profiles p
  WHERE p.privy_user_id = v_privy
  FOR UPDATE;

  IF FOUND THEN
    IF v_profile.wallet_address IS DISTINCT FROM v_wallet THEN
      RAISE EXCEPTION
        'FENN_CONFLICT: privy identity already anchored to a different wallet'
        USING ERRCODE = '23505';
    END IF;

    SELECT *
    INTO v_application
    FROM public.outlaw_applications a
    WHERE a.profile_id = v_profile.id
    FOR UPDATE;

    IF FOUND THEN
      created := false;
      profile_id := v_profile.id;
      outlaw_number := v_profile.outlaw_number;
      alias := v_profile.alias;
      wallet_address := v_profile.wallet_address;
      privy_user_id := v_profile.privy_user_id;
      joined_at := v_profile.joined_at;
      leaf_balance := v_profile.leaf_balance;
      leaf_lifetime_earned := v_profile.leaf_lifetime_earned;
      deeds_completed_count := v_profile.deeds_completed_count;
      greenwood_entered_at := v_profile.greenwood_entered_at;
      application_id := v_application.id;
      review_status := v_application.review_status;
      submitted_at := v_application.submitted_at;
      RETURN NEXT;
      RETURN;
    END IF;

    UPDATE public.profiles
    SET alias = v_name
    WHERE id = v_profile.id
    RETURNING * INTO v_profile;

    INSERT INTO public.outlaw_applications (
      profile_id,
      chosen_name,
      x_handle,
      why_statement,
      contribution_type,
      vow_accepted,
      terms_version,
      review_status,
      review_message,
      raw_answers
    ) VALUES (
      v_profile.id,
      v_name,
      v_x,
      v_why,
      v_contribution,
      TRUE,
      v_terms,
      'accepted',
      NULL,
      v_raw
    )
    RETURNING * INTO v_application;

    created := true;
    profile_id := v_profile.id;
    outlaw_number := v_profile.outlaw_number;
    alias := v_profile.alias;
    wallet_address := v_profile.wallet_address;
    privy_user_id := v_profile.privy_user_id;
    joined_at := v_profile.joined_at;
    leaf_balance := v_profile.leaf_balance;
    leaf_lifetime_earned := v_profile.leaf_lifetime_earned;
    deeds_completed_count := v_profile.deeds_completed_count;
    greenwood_entered_at := v_profile.greenwood_entered_at;
    application_id := v_application.id;
    review_status := v_application.review_status;
    submitted_at := v_application.submitted_at;
    RETURN NEXT;
    RETURN;
  END IF;

  -- CASE B: no profile by privy_user_id; check wallet
  SELECT *
  INTO v_profile
  FROM public.profiles p
  WHERE p.wallet_address = v_wallet
  FOR UPDATE;

  IF FOUND THEN
    IF v_profile.privy_user_id IS NOT NULL
       AND v_profile.privy_user_id IS DISTINCT FROM v_privy THEN
      RAISE EXCEPTION
        'FENN_CONFLICT: wallet already linked to another Privy identity'
        USING ERRCODE = '23505';
    END IF;

    IF v_profile.privy_user_id IS NULL THEN
      UPDATE public.profiles
      SET
        privy_user_id = v_privy,
        alias = v_name
      WHERE id = v_profile.id
        AND privy_user_id IS NULL
      RETURNING * INTO v_profile;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'FENN_CONFLICT: failed to claim wallet profile'
          USING ERRCODE = '23505';
      END IF;

      v_created := true;
    END IF;

    -- privy_user_id already matches, or was just claimed
    SELECT *
    INTO v_application
    FROM public.outlaw_applications a
    WHERE a.profile_id = v_profile.id
    FOR UPDATE;

    IF NOT FOUND THEN
      IF v_profile.alias IS DISTINCT FROM v_name THEN
        UPDATE public.profiles
        SET alias = v_name
        WHERE id = v_profile.id
        RETURNING * INTO v_profile;
      END IF;

      INSERT INTO public.outlaw_applications (
        profile_id,
        chosen_name,
        x_handle,
        why_statement,
        contribution_type,
        vow_accepted,
        terms_version,
        review_status,
        review_message,
        raw_answers
      ) VALUES (
        v_profile.id,
        v_name,
        v_x,
        v_why,
        v_contribution,
        TRUE,
        v_terms,
        'accepted',
        NULL,
        v_raw
      )
      RETURNING * INTO v_application;

      v_created := true;
    END IF;

    created := v_created;
    profile_id := v_profile.id;
    outlaw_number := v_profile.outlaw_number;
    alias := v_profile.alias;
    wallet_address := v_profile.wallet_address;
    privy_user_id := v_profile.privy_user_id;
    joined_at := v_profile.joined_at;
    leaf_balance := v_profile.leaf_balance;
    leaf_lifetime_earned := v_profile.leaf_lifetime_earned;
    deeds_completed_count := v_profile.deeds_completed_count;
    greenwood_entered_at := v_profile.greenwood_entered_at;
    application_id := v_application.id;
    review_status := v_application.review_status;
    submitted_at := v_application.submitted_at;
    RETURN NEXT;
    RETURN;
  END IF;

  -- CASE C: create profile + application atomically
  INSERT INTO public.profiles (
    wallet_address,
    privy_user_id,
    alias
  ) VALUES (
    v_wallet,
    v_privy,
    v_name
  )
  RETURNING * INTO v_profile;

  INSERT INTO public.outlaw_applications (
    profile_id,
    chosen_name,
    x_handle,
    why_statement,
    contribution_type,
    vow_accepted,
    terms_version,
    review_status,
    review_message,
    raw_answers
  ) VALUES (
    v_profile.id,
    v_name,
    v_x,
    v_why,
    v_contribution,
    TRUE,
    v_terms,
    'accepted',
    NULL,
    v_raw
  )
  RETURNING * INTO v_application;

  created := true;
  profile_id := v_profile.id;
  outlaw_number := v_profile.outlaw_number;
  alias := v_profile.alias;
  wallet_address := v_profile.wallet_address;
  privy_user_id := v_profile.privy_user_id;
  joined_at := v_profile.joined_at;
  leaf_balance := v_profile.leaf_balance;
  leaf_lifetime_earned := v_profile.leaf_lifetime_earned;
  deeds_completed_count := v_profile.deeds_completed_count;
  greenwood_entered_at := v_profile.greenwood_entered_at;
  application_id := v_application.id;
  review_status := v_application.review_status;
  submitted_at := v_application.submitted_at;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.register_outlaw(
  text, text, text, text, text, text, boolean, text, jsonb
) IS
  'Atomic Outlaw registration for trusted server/service-role callers. Does not authenticate Privy.';

-- Restrict execution: not a browser/anon registration path.
REVOKE ALL ON FUNCTION public.register_outlaw(
  text, text, text, text, text, text, boolean, text, jsonb
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.register_outlaw(
  text, text, text, text, text, text, boolean, text, jsonb
) FROM anon;

REVOKE ALL ON FUNCTION public.register_outlaw(
  text, text, text, text, text, text, boolean, text, jsonb
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.register_outlaw(
  text, text, text, text, text, text, boolean, text, jsonb
) TO service_role;

GRANT EXECUTE ON FUNCTION public.register_outlaw(
  text, text, text, text, text, text, boolean, text, jsonb
) TO postgres;
