-- FENN — Living Greenwood 3: Gatherings at The Fire + Raise Hand
-- LOCAL ONLY — do not apply until explicitly authorised.
--
-- Time-bound Greenwood Gatherings. Raise Hand is the first interaction.
-- No Hollow rewards, LEAF distribution, Wall, Book, or X side effects.

-- ---------------------------------------------------------------------------
-- greenwood_gatherings
-- ---------------------------------------------------------------------------
CREATE TABLE public.greenwood_gatherings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL,
  summary text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT 'fire',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  -- Administrative status. Member-facing "active" is also derived from time.
  status text NOT NULL DEFAULT 'draft',
  interaction_type text NOT NULL DEFAULT 'raise_hand',
  capacity integer,
  reward_leaf_preview integer,
  linked_deed_id uuid REFERENCES public.deeds (id) ON DELETE SET NULL,
  created_by_actor_id text NOT NULL,
  cancelled_at timestamptz,
  cancellation_reason text,
  closed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT greenwood_gatherings_title_nonempty
    CHECK (length(trim(title)) > 0),
  CONSTRAINT greenwood_gatherings_slug_nonempty
    CHECK (length(trim(slug)) > 0),
  CONSTRAINT greenwood_gatherings_location_check
    CHECK (location IN ('fire')),
  CONSTRAINT greenwood_gatherings_status_check
    CHECK (status IN ('draft', 'scheduled', 'active', 'closed', 'cancelled')),
  CONSTRAINT greenwood_gatherings_interaction_type_check
    CHECK (interaction_type IN ('raise_hand')),
  CONSTRAINT greenwood_gatherings_time_window
    CHECK (ends_at > starts_at),
  CONSTRAINT greenwood_gatherings_capacity_positive
    CHECK (capacity IS NULL OR capacity > 0),
  CONSTRAINT greenwood_gatherings_reward_preview_nonnegative
    CHECK (reward_leaf_preview IS NULL OR reward_leaf_preview >= 0),
  CONSTRAINT greenwood_gatherings_created_by_nonempty
    CHECK (length(trim(created_by_actor_id)) > 0),
  CONSTRAINT greenwood_gatherings_cancelled_consistent
    CHECK (
      (status <> 'cancelled' AND cancelled_at IS NULL)
      OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX greenwood_gatherings_slug_uidx
  ON public.greenwood_gatherings (slug);

CREATE INDEX greenwood_gatherings_location_window_idx
  ON public.greenwood_gatherings (location, starts_at, ends_at);

CREATE INDEX greenwood_gatherings_status_starts_idx
  ON public.greenwood_gatherings (status, starts_at ASC);

CREATE TRIGGER greenwood_gatherings_set_updated_at
  BEFORE UPDATE ON public.greenwood_gatherings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.greenwood_gatherings IS
  'Greenwood Gatherings at The Fire. Member "active" is derived from status + server time.';

-- Reject overlapping published Fire gatherings (scheduled/active, not cancelled).
CREATE OR REPLACE FUNCTION public.prevent_overlapping_fire_gatherings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.location IS DISTINCT FROM 'fire' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('draft', 'closed', 'cancelled') THEN
    RETURN NEW;
  END IF;

  -- Published windows: scheduled or active
  IF EXISTS (
    SELECT 1
    FROM public.greenwood_gatherings g
    WHERE g.id IS DISTINCT FROM NEW.id
      AND g.location = NEW.location
      AND g.status IN ('scheduled', 'active')
      AND g.cancelled_at IS NULL
      AND tstzrange(g.starts_at, g.ends_at, '[)')
          && tstzrange(NEW.starts_at, NEW.ends_at, '[)')
  ) THEN
    RAISE EXCEPTION
      'FENN_GATHERING_OVERLAP: another published Fire Gathering overlaps this window'
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER greenwood_gatherings_prevent_overlap
  BEFORE INSERT OR UPDATE OF starts_at, ends_at, status, location, cancelled_at
  ON public.greenwood_gatherings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_overlapping_fire_gatherings();

-- ---------------------------------------------------------------------------
-- Attendance (durable; one row per profile per Gathering)
-- ---------------------------------------------------------------------------
CREATE TABLE public.greenwood_gathering_attendance (
  gathering_id uuid NOT NULL REFERENCES public.greenwood_gatherings (id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  first_attended_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  attendance_source text NOT NULL DEFAULT 'raise_hand',
  last_interaction_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT greenwood_gathering_attendance_pkey
    PRIMARY KEY (gathering_id, profile_id),
  CONSTRAINT greenwood_gathering_attendance_source_check
    CHECK (attendance_source IN ('raise_hand'))
);

CREATE INDEX greenwood_gathering_attendance_profile_idx
  ON public.greenwood_gathering_attendance (profile_id, first_attended_at DESC);

CREATE TRIGGER greenwood_gathering_attendance_set_updated_at
  BEFORE UPDATE ON public.greenwood_gathering_attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.greenwood_gathering_attendance IS
  'Durable Gathering attendance. Not inferred from Fire heartbeat presence.';

-- ---------------------------------------------------------------------------
-- Hands (historical rows; one open hand per profile per Gathering)
-- ---------------------------------------------------------------------------
CREATE TABLE public.greenwood_gathering_hands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gathering_id uuid NOT NULL REFERENCES public.greenwood_gatherings (id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  raised_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  lowered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT greenwood_gathering_hands_lowered_after_raised
    CHECK (lowered_at IS NULL OR lowered_at >= raised_at)
);

-- At most one currently raised hand per member per Gathering.
CREATE UNIQUE INDEX greenwood_gathering_hands_open_uidx
  ON public.greenwood_gathering_hands (gathering_id, profile_id)
  WHERE lowered_at IS NULL;

CREATE INDEX greenwood_gathering_hands_gathering_raised_idx
  ON public.greenwood_gathering_hands (gathering_id, raised_at DESC);

CREATE INDEX greenwood_gathering_hands_profile_idx
  ON public.greenwood_gathering_hands (profile_id, raised_at DESC);

CREATE TRIGGER greenwood_gathering_hands_set_updated_at
  BEFORE UPDATE ON public.greenwood_gathering_hands
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.greenwood_gathering_hands IS
  'Raise Hand history. Open hand = lowered_at IS NULL. Future reward snapshot uses open hands at close.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.greenwood_gatherings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.greenwood_gathering_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.greenwood_gathering_hands ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.greenwood_gatherings FROM anon, authenticated;
REVOKE ALL ON public.greenwood_gathering_attendance FROM anon, authenticated;
REVOKE ALL ON public.greenwood_gathering_hands FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Raise hand (transactional, capacity-aware, attendance upsert)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.raise_greenwood_gathering_hand(
  p_gathering_id uuid,
  p_profile_id uuid
)
RETURNS TABLE (
  gathering_id uuid,
  profile_id uuid,
  hand_id uuid,
  raised_at timestamptz,
  lowered_at timestamptz,
  newly_raised boolean,
  hand_count integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_member timestamptz;
  v_g public.greenwood_gatherings%ROWTYPE;
  v_now timestamptz := timezone('utc', now());
  v_open public.greenwood_gathering_hands%ROWTYPE;
  v_hand public.greenwood_gathering_hands%ROWTYPE;
  v_count integer;
  v_newly boolean := false;
BEGIN
  IF p_gathering_id IS NULL OR p_profile_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: gathering_id and profile_id required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(87201434, hashtext(p_gathering_id::text));

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

  SELECT g.*
  INTO v_g
  FROM public.greenwood_gatherings g
  WHERE g.id = p_gathering_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_GATHERING_NOT_FOUND: gathering missing'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_g.status = 'cancelled' OR v_g.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'FENN_GATHERING_CANCELLED: gathering cancelled'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_g.status = 'draft' THEN
    RAISE EXCEPTION 'FENN_GATHERING_NOT_VISIBLE: gathering is draft'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_g.status = 'closed' OR v_g.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'FENN_GATHERING_CLOSED: gathering closed'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_g.interaction_type IS DISTINCT FROM 'raise_hand' THEN
    RAISE EXCEPTION 'FENN_GATHERING_INTERACTION: raise_hand not supported'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_now < v_g.starts_at THEN
    RAISE EXCEPTION 'FENN_GATHERING_NOT_ACTIVE: gathering has not started'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_now >= v_g.ends_at THEN
    RAISE EXCEPTION 'FENN_GATHERING_CLOSED: gathering window ended'
      USING ERRCODE = 'P0001';
  END IF;

  -- Open hand already?
  SELECT h.*
  INTO v_open
  FROM public.greenwood_gathering_hands h
  WHERE h.gathering_id = p_gathering_id
    AND h.profile_id = p_profile_id
    AND h.lowered_at IS NULL;

  IF FOUND THEN
    v_hand := v_open;
    v_newly := false;
  ELSE
    SELECT count(*)::integer
    INTO v_count
    FROM public.greenwood_gathering_hands h
    WHERE h.gathering_id = p_gathering_id
      AND h.lowered_at IS NULL;

    IF v_g.capacity IS NOT NULL AND v_count >= v_g.capacity THEN
      RAISE EXCEPTION 'FENN_GATHERING_FULL: gathering capacity reached'
        USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.greenwood_gathering_hands AS gh (
      gathering_id,
      profile_id,
      raised_at
    ) VALUES (
      p_gathering_id,
      p_profile_id,
      v_now
    )
    RETURNING gh.* INTO v_hand;

    v_newly := true;
  END IF;

  INSERT INTO public.greenwood_gathering_attendance AS ga (
    gathering_id,
    profile_id,
    first_attended_at,
    attendance_source,
    last_interaction_at
  ) VALUES (
    p_gathering_id,
    p_profile_id,
    v_now,
    'raise_hand',
    v_now
  )
  ON CONFLICT ON CONSTRAINT greenwood_gathering_attendance_pkey DO UPDATE
  SET
    last_interaction_at = v_now;

  SELECT count(*)::integer
  INTO v_count
  FROM public.greenwood_gathering_hands h
  WHERE h.gathering_id = p_gathering_id
    AND h.lowered_at IS NULL;

  RETURN QUERY
  SELECT
    p_gathering_id,
    p_profile_id,
    v_hand.id,
    v_hand.raised_at,
    v_hand.lowered_at,
    v_newly,
    v_count;
END;
$$;

COMMENT ON FUNCTION public.raise_greenwood_gathering_hand(uuid, uuid) IS
  'Idempotent Raise Hand during an active Gathering. Upserts attendance. No LEAF.';

REVOKE ALL ON FUNCTION public.raise_greenwood_gathering_hand(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.raise_greenwood_gathering_hand(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Lower hand
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lower_greenwood_gathering_hand(
  p_gathering_id uuid,
  p_profile_id uuid
)
RETURNS TABLE (
  gathering_id uuid,
  profile_id uuid,
  hand_id uuid,
  raised_at timestamptz,
  lowered_at timestamptz,
  newly_lowered boolean,
  hand_count integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_member timestamptz;
  v_g public.greenwood_gatherings%ROWTYPE;
  v_now timestamptz := timezone('utc', now());
  v_open public.greenwood_gathering_hands%ROWTYPE;
  v_hand public.greenwood_gathering_hands%ROWTYPE;
  v_count integer;
  v_newly boolean := false;
  v_has_hand boolean := false;
BEGIN
  IF p_gathering_id IS NULL OR p_profile_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: gathering_id and profile_id required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(87201434, hashtext(p_gathering_id::text));

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

  SELECT g.*
  INTO v_g
  FROM public.greenwood_gatherings g
  WHERE g.id = p_gathering_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_GATHERING_NOT_FOUND: gathering missing'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_g.status = 'cancelled' OR v_g.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'FENN_GATHERING_CANCELLED: gathering cancelled'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_g.status = 'draft' THEN
    RAISE EXCEPTION 'FENN_GATHERING_NOT_VISIBLE: gathering is draft'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_g.status = 'closed' OR v_g.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'FENN_GATHERING_CLOSED: gathering closed'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_now < v_g.starts_at OR v_now >= v_g.ends_at THEN
    RAISE EXCEPTION 'FENN_GATHERING_NOT_ACTIVE: gathering is not active'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT h.*
  INTO v_open
  FROM public.greenwood_gathering_hands h
  WHERE h.gathering_id = p_gathering_id
    AND h.profile_id = p_profile_id
    AND h.lowered_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Idempotent: already lowered / never raised. Return latest historical if any.
    SELECT h.*
    INTO v_hand
    FROM public.greenwood_gathering_hands h
    WHERE h.gathering_id = p_gathering_id
      AND h.profile_id = p_profile_id
    ORDER BY h.raised_at DESC
    LIMIT 1;

    v_has_hand := FOUND;
    v_newly := false;
  ELSE
    UPDATE public.greenwood_gathering_hands AS h
    SET lowered_at = v_now
    WHERE h.id = v_open.id
    RETURNING h.* INTO v_hand;

    v_has_hand := true;
    v_newly := true;

    UPDATE public.greenwood_gathering_attendance AS a
    SET last_interaction_at = v_now
    WHERE a.gathering_id = p_gathering_id
      AND a.profile_id = p_profile_id;
  END IF;

  SELECT count(*)::integer
  INTO v_count
  FROM public.greenwood_gathering_hands h
  WHERE h.gathering_id = p_gathering_id
    AND h.lowered_at IS NULL;

  RETURN QUERY
  SELECT
    p_gathering_id,
    p_profile_id,
    CASE WHEN v_has_hand THEN v_hand.id ELSE NULL END,
    CASE WHEN v_has_hand THEN v_hand.raised_at ELSE NULL END,
    CASE WHEN v_has_hand THEN v_hand.lowered_at ELSE NULL END,
    v_newly,
    v_count;
END;
$$;

COMMENT ON FUNCTION public.lower_greenwood_gathering_hand(uuid, uuid) IS
  'Idempotent Lower Hand during an active Gathering. Keeps attendance.';

REVOKE ALL ON FUNCTION public.lower_greenwood_gathering_hand(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lower_greenwood_gathering_hand(uuid, uuid) TO service_role;
