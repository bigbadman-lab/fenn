-- FENN — Greenwood first-arrival ceremony completion
-- LOCAL ONLY — do not apply until explicitly authorised.
--
-- One-time full-screen arrival after first Greenwood admission.
-- Durable profile state; not part of the write-once admission triad.
-- Existing members are backfilled as already complete so they never see
-- the ceremony after deployment.

-- ---------------------------------------------------------------------------
-- Column
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS greenwood_arrival_ceremony_completed_at timestamptz;

COMMENT ON COLUMN public.profiles.greenwood_arrival_ceremony_completed_at IS
  'When the member completed the one-time Greenwood arrival ceremony. NULL = pending for members; non-members must remain NULL.';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_greenwood_arrival_ceremony_member_only;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_greenwood_arrival_ceremony_member_only
  CHECK (
    greenwood_arrival_ceremony_completed_at IS NULL
    OR greenwood_entered_at IS NOT NULL
  );

-- Existing Greenwood members: treat as already having completed the ceremony.
UPDATE public.profiles
SET greenwood_arrival_ceremony_completed_at = greenwood_entered_at
WHERE greenwood_entered_at IS NOT NULL
  AND greenwood_arrival_ceremony_completed_at IS NULL;

-- ---------------------------------------------------------------------------
-- Idempotent completion RPC (service_role / trusted server only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_greenwood_arrival_ceremony(
  p_profile_id uuid
)
RETURNS TABLE (
  status text,
  completed_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_entered_at timestamptz;
  v_completed_at timestamptz;
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: profile_id required'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.greenwood_entered_at, p.greenwood_arrival_ceremony_completed_at
  INTO v_entered_at, v_completed_at
  FROM public.profiles AS p
  WHERE p.id = p_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_PROFILE_NOT_FOUND: profile does not exist'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_entered_at IS NULL THEN
    status := 'not_member';
    completed_at := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_completed_at IS NOT NULL THEN
    status := 'already_completed';
    completed_at := v_completed_at;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.profiles AS p
  SET greenwood_arrival_ceremony_completed_at = timezone('utc', now())
  WHERE p.id = p_profile_id
    AND p.greenwood_entered_at IS NOT NULL
    AND p.greenwood_arrival_ceremony_completed_at IS NULL
  RETURNING p.greenwood_arrival_ceremony_completed_at
  INTO v_completed_at;

  IF v_completed_at IS NULL THEN
    -- Concurrent completer won the race; re-read.
    SELECT p.greenwood_arrival_ceremony_completed_at
    INTO v_completed_at
    FROM public.profiles AS p
    WHERE p.id = p_profile_id;

    status := 'already_completed';
    completed_at := v_completed_at;
    RETURN NEXT;
    RETURN;
  END IF;

  status := 'completed';
  completed_at := v_completed_at;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.complete_greenwood_arrival_ceremony(uuid) IS
  'Idempotent one-time Greenwood arrival ceremony completion. Members only. Does not alter admission triad.';

REVOKE ALL ON FUNCTION public.complete_greenwood_arrival_ceremony(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_greenwood_arrival_ceremony(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_greenwood_arrival_ceremony(uuid) TO service_role;
