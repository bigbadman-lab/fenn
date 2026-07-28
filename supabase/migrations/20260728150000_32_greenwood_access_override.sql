-- FENN — Greenwood access override for trusted test/founder wallets
-- LOCAL ONLY — do not apply until explicitly authorised.
--
-- Extends admit_to_greenwood with optional p_access_override.
-- When true (set only by trusted Next.js after env allowlist check):
--   skips lifetime LEAF threshold gate
--   still writes REAL lifetime LEAF at entry
--   awards/spends zero LEAF
--   creates normal permanent membership

DROP FUNCTION IF EXISTS public.admit_to_greenwood(uuid);

CREATE OR REPLACE FUNCTION public.admit_to_greenwood(
  p_profile_id uuid,
  p_access_override boolean DEFAULT false
)
RETURNS TABLE (
  status text,
  newly_admitted boolean,
  profile_id uuid,
  lifetime_leaf bigint,
  threshold integer,
  greenwood_entered_at timestamptz,
  greenwood_threshold_at_entry integer,
  greenwood_lifetime_leaf_at_entry bigint
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_setting jsonb;
  v_threshold integer;
  v_lifetime bigint;
  v_entered_at timestamptz;
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: profile_id required'
      USING ERRCODE = '22023';
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

  IF v_profile.greenwood_entered_at IS NOT NULL THEN
    status := 'already_member';
    newly_admitted := false;
    profile_id := v_profile.id;
    lifetime_leaf := v_profile.greenwood_lifetime_leaf_at_entry;
    threshold := v_profile.greenwood_threshold_at_entry;
    greenwood_entered_at := v_profile.greenwood_entered_at;
    greenwood_threshold_at_entry := v_profile.greenwood_threshold_at_entry;
    greenwood_lifetime_leaf_at_entry := v_profile.greenwood_lifetime_leaf_at_entry;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT s.value
  INTO v_setting
  FROM public.app_settings s
  WHERE s.key = 'greenwood.lifetime_leaf_threshold';

  IF NOT FOUND OR v_setting IS NULL THEN
    RAISE EXCEPTION
      'FENN_GREENWOOD_THRESHOLD_MISSING: greenwood.lifetime_leaf_threshold is not configured'
      USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_typeof(v_setting) = 'number' THEN
    v_threshold := (v_setting #>> '{}')::integer;
  ELSIF jsonb_typeof(v_setting) = 'object' AND (v_setting ? 'threshold') THEN
    IF jsonb_typeof(v_setting -> 'threshold') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION
        'FENN_GREENWOOD_THRESHOLD_INVALID: threshold must be a nonnegative integer'
        USING ERRCODE = '22023';
    END IF;
    v_threshold := (v_setting ->> 'threshold')::integer;
  ELSE
    RAISE EXCEPTION
      'FENN_GREENWOOD_THRESHOLD_INVALID: unsupported app_settings value shape'
      USING ERRCODE = '22023';
  END IF;

  IF v_threshold IS NULL OR v_threshold < 0 THEN
    RAISE EXCEPTION
      'FENN_GREENWOOD_THRESHOLD_INVALID: threshold must be a nonnegative integer'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(l.lifetime_delta), 0)
  INTO v_lifetime
  FROM public.leaf_ledger l
  WHERE l.profile_id = v_profile.id;

  -- Access override skips the LEAF gate only. Lifetime recorded is still real.
  IF NOT COALESCE(p_access_override, false) AND v_lifetime < v_threshold THEN
    status := 'not_eligible';
    newly_admitted := false;
    profile_id := v_profile.id;
    lifetime_leaf := v_lifetime;
    threshold := v_threshold;
    greenwood_entered_at := NULL;
    greenwood_threshold_at_entry := NULL;
    greenwood_lifetime_leaf_at_entry := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  v_entered_at := timezone('utc', now());

  UPDATE public.profiles p
  SET
    greenwood_entered_at = v_entered_at,
    greenwood_threshold_at_entry = v_threshold,
    greenwood_lifetime_leaf_at_entry = v_lifetime,
    updated_at = timezone('utc', now())
  WHERE p.id = v_profile.id
    AND p.greenwood_entered_at IS NULL
  RETURNING * INTO v_profile;

  IF NOT FOUND THEN
    SELECT *
    INTO v_profile
    FROM public.profiles p
    WHERE p.id = p_profile_id
    FOR UPDATE;

    IF v_profile.greenwood_entered_at IS NULL THEN
      RAISE EXCEPTION
        'FENN_GREENWOOD_ADMIT_FAILED: admission write did not apply'
        USING ERRCODE = 'P0001';
    END IF;

    status := 'already_member';
    newly_admitted := false;
    profile_id := v_profile.id;
    lifetime_leaf := v_profile.greenwood_lifetime_leaf_at_entry;
    threshold := v_profile.greenwood_threshold_at_entry;
    greenwood_entered_at := v_profile.greenwood_entered_at;
    greenwood_threshold_at_entry := v_profile.greenwood_threshold_at_entry;
    greenwood_lifetime_leaf_at_entry := v_profile.greenwood_lifetime_leaf_at_entry;
    RETURN NEXT;
    RETURN;
  END IF;

  status := 'admitted';
  newly_admitted := true;
  profile_id := v_profile.id;
  lifetime_leaf := v_lifetime;
  threshold := v_threshold;
  greenwood_entered_at := v_profile.greenwood_entered_at;
  greenwood_threshold_at_entry := v_profile.greenwood_threshold_at_entry;
  greenwood_lifetime_leaf_at_entry := v_profile.greenwood_lifetime_leaf_at_entry;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.admit_to_greenwood(uuid, boolean) IS
  'Atomic Greenwood admission: lifetime LEAF vs threshold, or trusted p_access_override. Write-once membership. service_role only. Awards/spends zero LEAF.';

REVOKE ALL ON FUNCTION public.admit_to_greenwood(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admit_to_greenwood(uuid, boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_to_greenwood(uuid, boolean) TO service_role;
