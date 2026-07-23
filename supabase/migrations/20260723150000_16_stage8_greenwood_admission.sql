-- FENN Stage 8.1 — Additive: Greenwood threshold seed + atomic admission RPC
-- LOCAL ONLY — do not apply until explicitly authorised.
-- Does not modify prior migration files.
--
-- Purpose: permanent write-once Greenwood admission based on lifetime LEAF.
-- Eligibility uses authoritative leaf_ledger SUM(lifetime_delta), never
-- spendable leaf_balance. Profile FOR UPDATE serializes concurrent ENTER.
-- Trusted server/service-role path only. Does NOT authenticate end users.
-- Caller (Next.js, Stage 8.2+) must authorize via Privy before invoking.

-- ---------------------------------------------------------------------------
-- Seed MVP Greenwood threshold (canonical configuration)
-- Representation: bare JSON number — matches Stage 4 standing helper.
-- ---------------------------------------------------------------------------
INSERT INTO public.app_settings (key, value, description)
VALUES (
  'greenwood.lifetime_leaf_threshold',
  '30'::jsonb,
  'Lifetime LEAF required to enter The Greenwood. Membership uses lifetime earned, not spendable balance.'
)
ON CONFLICT (key) DO UPDATE
SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  updated_at = timezone('utc', now());

-- ---------------------------------------------------------------------------
-- Write-once protection for Greenwood admission snapshots
-- Allows NULL → populated admission; blocks later mutation of the triad.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_greenwood_admission_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.greenwood_entered_at IS NOT NULL THEN
    IF NEW.greenwood_entered_at IS DISTINCT FROM OLD.greenwood_entered_at
       OR NEW.greenwood_threshold_at_entry IS DISTINCT FROM OLD.greenwood_threshold_at_entry
       OR NEW.greenwood_lifetime_leaf_at_entry IS DISTINCT FROM OLD.greenwood_lifetime_leaf_at_entry
    THEN
      RAISE EXCEPTION
        'FENN_GREENWOOD_IMMUTABLE: Greenwood admission snapshot cannot be modified'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_prevent_greenwood_admission_mutation
  ON public.profiles;

CREATE TRIGGER profiles_prevent_greenwood_admission_mutation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_greenwood_admission_mutation();

COMMENT ON FUNCTION public.prevent_greenwood_admission_mutation() IS
  'Write-once Greenwood admission: after greenwood_entered_at is set, the admission snapshot triad cannot change.';

-- ---------------------------------------------------------------------------
-- public.admit_to_greenwood
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admit_to_greenwood(
  p_profile_id uuid
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

  -- Concurrency boundary for Greenwood admission on this profile.
  SELECT *
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = p_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_PROFILE_NOT_FOUND: profile missing'
      USING ERRCODE = 'P0002';
  END IF;

  -- Permanent membership: idempotent replay — never rewrite snapshots.
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

  -- Threshold from app_settings — fail closed if absent/invalid.
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

  -- Authoritative lifetime LEAF for irreversible admission:
  -- SUM(leaf_ledger.lifetime_delta) under the profile lock.
  -- Stage 4: leaf_ledger is source of truth; profiles.leaf_lifetime_earned is
  -- the trigger-maintained cache. Admission does not mutate LEAF.
  -- Profile FOR UPDATE serializes with cache updates from concurrent ledger
  -- inserts (trigger UPDATEs the same profile row).
  SELECT COALESCE(SUM(l.lifetime_delta), 0)
  INTO v_lifetime
  FROM public.leaf_ledger l
  WHERE l.profile_id = v_profile.id;

  IF v_lifetime < v_threshold THEN
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
    -- Lost race to another concurrent admit — reload as already_member.
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

COMMENT ON FUNCTION public.admit_to_greenwood(uuid) IS
  'Atomic Greenwood admission: lifetime LEAF from leaf_ledger SUM(lifetime_delta) vs app_settings threshold. Write-once membership. service_role only. Awards/spends zero LEAF.';

REVOKE ALL ON FUNCTION public.admit_to_greenwood(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admit_to_greenwood(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_to_greenwood(uuid) TO service_role;
