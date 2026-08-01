-- FENN — Living Greenwood 2 hotfix: disambiguate presence RPC column refs
-- LOCAL ONLY — do not apply until explicitly authorised.
--
-- RETURNS TABLE (profile_id ...) made INSERT/ON CONFLICT (profile_id) ambiguous.
-- Rewrite RPCs to use ON CONFLICT ON CONSTRAINT + RETURN QUERY.

CREATE OR REPLACE FUNCTION public.heartbeat_greenwood_presence(
  p_profile_id uuid
)
RETURNS TABLE (
  profile_id uuid,
  last_seen_at timestamptz,
  sitting boolean,
  sitting_since timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_member timestamptz;
  v_row public.greenwood_presence%ROWTYPE;
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: profile_id required'
      USING ERRCODE = '22023';
  END IF;

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

  INSERT INTO public.greenwood_presence AS gp (
    profile_id,
    last_seen_at,
    sitting,
    sitting_since
  ) VALUES (
    p_profile_id,
    timezone('utc', now()),
    false,
    NULL
  )
  ON CONFLICT ON CONSTRAINT greenwood_presence_pkey DO UPDATE
  SET
    last_seen_at = timezone('utc', now())
  RETURNING gp.* INTO v_row;

  RETURN QUERY
  SELECT
    v_row.profile_id,
    v_row.last_seen_at,
    v_row.sitting,
    v_row.sitting_since;
END;
$$;

CREATE OR REPLACE FUNCTION public.sit_greenwood_presence(
  p_profile_id uuid
)
RETURNS TABLE (
  profile_id uuid,
  last_seen_at timestamptz,
  sitting boolean,
  sitting_since timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_member timestamptz;
  v_row public.greenwood_presence%ROWTYPE;
  v_now timestamptz := timezone('utc', now());
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: profile_id required'
      USING ERRCODE = '22023';
  END IF;

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

  INSERT INTO public.greenwood_presence AS gp (
    profile_id,
    last_seen_at,
    sitting,
    sitting_since
  ) VALUES (
    p_profile_id,
    v_now,
    true,
    v_now
  )
  ON CONFLICT ON CONSTRAINT greenwood_presence_pkey DO UPDATE
  SET
    last_seen_at = v_now,
    sitting = true,
    sitting_since = COALESCE(gp.sitting_since, v_now)
  RETURNING gp.* INTO v_row;

  RETURN QUERY
  SELECT
    v_row.profile_id,
    v_row.last_seen_at,
    v_row.sitting,
    v_row.sitting_since;
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_greenwood_presence(
  p_profile_id uuid
)
RETURNS TABLE (
  profile_id uuid,
  last_seen_at timestamptz,
  sitting boolean,
  sitting_since timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_member timestamptz;
  v_row public.greenwood_presence%ROWTYPE;
  v_now timestamptz := timezone('utc', now());
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: profile_id required'
      USING ERRCODE = '22023';
  END IF;

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

  INSERT INTO public.greenwood_presence AS gp (
    profile_id,
    last_seen_at,
    sitting,
    sitting_since
  ) VALUES (
    p_profile_id,
    v_now,
    false,
    NULL
  )
  ON CONFLICT ON CONSTRAINT greenwood_presence_pkey DO UPDATE
  SET
    last_seen_at = v_now,
    sitting = false,
    sitting_since = NULL
  RETURNING gp.* INTO v_row;

  RETURN QUERY
  SELECT
    v_row.profile_id,
    v_row.last_seen_at,
    v_row.sitting,
    v_row.sitting_since;
END;
$$;

COMMENT ON FUNCTION public.heartbeat_greenwood_presence(uuid) IS
  'Idempotent Fire heartbeat. Refreshes last_seen_at; does not change sitting.';
COMMENT ON FUNCTION public.sit_greenwood_presence(uuid) IS
  'Idempotent sit-by-the-Fire. Sets sitting=true and refreshes heartbeat.';
COMMENT ON FUNCTION public.leave_greenwood_presence(uuid) IS
  'Idempotent leave sitting. Clears sitting; refreshes heartbeat.';

REVOKE ALL ON FUNCTION public.heartbeat_greenwood_presence(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sit_greenwood_presence(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.leave_greenwood_presence(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.heartbeat_greenwood_presence(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sit_greenwood_presence(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.leave_greenwood_presence(uuid) TO service_role;
