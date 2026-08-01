-- FENN — Living Greenwood 2: Fire presence + sitting
-- LOCAL ONLY — do not apply until explicitly authorised.
--
-- Ephemeral Greenwood member presence at The Fire.
-- Does not create gatherings, Raise Hand, Hollow, rewards, or Realtime.

-- ---------------------------------------------------------------------------
-- greenwood_presence (one row per profile; timeout is authority)
-- ---------------------------------------------------------------------------
CREATE TABLE public.greenwood_presence (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE RESTRICT,
  last_seen_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  sitting boolean NOT NULL DEFAULT false,
  sitting_since timestamptz,
  session_nonce text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT greenwood_presence_sitting_since_consistent
    CHECK (
      (sitting = false AND sitting_since IS NULL)
      OR (sitting = true AND sitting_since IS NOT NULL)
    )
);

CREATE INDEX greenwood_presence_last_seen_at_idx
  ON public.greenwood_presence (last_seen_at DESC);

CREATE INDEX greenwood_presence_active_sitting_idx
  ON public.greenwood_presence (sitting, last_seen_at DESC)
  WHERE sitting = true;

CREATE TRIGGER greenwood_presence_set_updated_at
  BEFORE UPDATE ON public.greenwood_presence
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.greenwood_presence IS
  'Ephemeral Fire presence. Timeout filtering is authority; not append-only history.';

-- ---------------------------------------------------------------------------
-- RLS: private — service-role after Privy only
-- ---------------------------------------------------------------------------
ALTER TABLE public.greenwood_presence ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.greenwood_presence FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Heartbeat: upsert last_seen_at; preserve sitting
-- ---------------------------------------------------------------------------
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
