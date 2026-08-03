-- FENN — THE FIRST THIRTY (onboarding progression)
-- LOCAL ONLY — do not apply until explicitly authorised.
--
-- Deterministic arrival path: up to 30 lifetime LEAF via three once-only milestones.
-- Ordinary CAMP grants suppressed while progress.status = 'active'.
-- Milestone satisfaction is separate from LEAF grant amount.

-- ---------------------------------------------------------------------------
-- Ledger: allow source_type = onboarding
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
      'hollow',
      'onboarding'
    )
  );

-- ---------------------------------------------------------------------------
-- first_thirty_progress
-- ---------------------------------------------------------------------------
CREATE TABLE public.first_thirty_progress (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active',
  eligible_camp_exchange_count integer NOT NULL DEFAULT 0,
  first_camp_satisfied_at timestamptz,
  third_camp_satisfied_at timestamptz,
  first_deed_satisfied_at timestamptz,
  first_camp_leaf_granted integer NOT NULL DEFAULT 0,
  third_camp_leaf_granted integer NOT NULL DEFAULT 0,
  first_deed_leaf_granted integer NOT NULL DEFAULT 0,
  onboarding_leaf_granted integer NOT NULL DEFAULT 0,
  first_eligible_message_id uuid REFERENCES public.camp_messages (id) ON DELETE RESTRICT,
  third_eligible_message_id uuid REFERENCES public.camp_messages (id) ON DELETE RESTRICT,
  first_deed_submission_id uuid,
  finished_reason text,
  completed_at timestamptz,
  terminated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT first_thirty_progress_status_check
    CHECK (status IN ('active', 'completed', 'terminated')),
  CONSTRAINT first_thirty_progress_count_nonneg
    CHECK (eligible_camp_exchange_count >= 0),
  CONSTRAINT first_thirty_progress_leaf_nonneg
    CHECK (
      first_camp_leaf_granted >= 0
      AND third_camp_leaf_granted >= 0
      AND first_deed_leaf_granted >= 0
      AND onboarding_leaf_granted >= 0
    )
);

CREATE TRIGGER first_thirty_progress_set_updated_at
  BEFORE UPDATE ON public.first_thirty_progress
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.first_thirty_progress IS
  'THE FIRST THIRTY onboarding progression. Lazy-created on first CAMP/Deed event. Status active suppresses ordinary CAMP grants.';

-- ---------------------------------------------------------------------------
-- Exactly-once eligible CAMP exchange markers
-- ---------------------------------------------------------------------------
CREATE TABLE public.first_thirty_camp_exchanges (
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  assistant_message_id uuid NOT NULL REFERENCES public.camp_messages (id) ON DELETE RESTRICT,
  eligible boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  PRIMARY KEY (assistant_message_id),
  CONSTRAINT first_thirty_camp_exchanges_profile_message_uidx
    UNIQUE (profile_id, assistant_message_id)
);

CREATE INDEX first_thirty_camp_exchanges_profile_idx
  ON public.first_thirty_camp_exchanges (profile_id, created_at DESC);

COMMENT ON TABLE public.first_thirty_camp_exchanges IS
  'Exact-once CAMP exchange processing for First Thirty eligibility counting.';

-- ---------------------------------------------------------------------------
-- Helpers (service-role RPCs only at end)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.first_thirty_greenwood_threshold()
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_setting jsonb;
  v_threshold integer;
BEGIN
  SELECT s.value INTO v_setting
  FROM public.app_settings s
  WHERE s.key = 'greenwood.lifetime_leaf_threshold';

  IF NOT FOUND THEN
    RETURN 30;
  END IF;

  IF jsonb_typeof(v_setting) = 'number' THEN
    v_threshold := GREATEST(0, (v_setting #>> '{}')::integer);
  ELSIF jsonb_typeof(v_setting) = 'object' AND (v_setting ? 'threshold') THEN
    v_threshold := GREATEST(0, (v_setting ->> 'threshold')::integer);
  ELSE
    v_threshold := 30;
  END IF;

  RETURN v_threshold;
END;
$$;

CREATE OR REPLACE FUNCTION public.first_thirty_lifetime_leaf(p_profile_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(l.lifetime_delta), 0)::bigint
  FROM public.leaf_ledger l
  WHERE l.profile_id = p_profile_id;
$$;

CREATE OR REPLACE FUNCTION public.first_thirty_insert_grant(
  p_profile_id uuid,
  p_wallet text,
  p_milestone text,
  p_actual integer,
  p_threshold integer,
  p_lifetime_before bigint,
  p_secondary_source_id text,
  p_reason text,
  p_metadata jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_ledger public.leaf_ledger%ROWTYPE;
BEGIN
  IF p_actual IS NULL OR p_actual <= 0 THEN
    RETURN NULL;
  END IF;

  v_key := 'first_thirty:' || p_profile_id::text || ':' || p_milestone;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 2));

  SELECT * INTO v_ledger
  FROM public.leaf_ledger l
  WHERE l.idempotency_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    RETURN v_ledger.id;
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
    p_wallet,
    p_actual,
    p_actual,
    'onboarding',
    p_milestone,
    p_secondary_source_id,
    p_reason,
    'system',
    'first_thirty',
    v_key,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'milestone', p_milestone,
      'nominalGrant', 10,
      'actualGrant', p_actual,
      'threshold', p_threshold,
      'lifetimeBefore', p_lifetime_before
    )
  )
  RETURNING * INTO v_ledger;

  RETURN v_ledger.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.first_thirty_close_if_needed(
  p_progress public.first_thirty_progress,
  p_lifetime bigint,
  p_threshold integer,
  p_is_greenwood boolean
)
RETURNS public.first_thirty_progress
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_progress public.first_thirty_progress;
  v_all_satisfied boolean;
  v_reason text;
  v_status text;
BEGIN
  v_progress := p_progress;

  IF v_progress.status IS DISTINCT FROM 'active' THEN
    RETURN v_progress;
  END IF;

  v_all_satisfied :=
    v_progress.first_camp_satisfied_at IS NOT NULL
    AND v_progress.third_camp_satisfied_at IS NOT NULL
    AND v_progress.first_deed_satisfied_at IS NOT NULL;

  IF p_is_greenwood OR p_lifetime >= p_threshold THEN
    IF p_is_greenwood THEN
      v_reason := 'greenwood_member';
    ELSE
      v_reason := 'lifetime_threshold';
    END IF;

    IF v_all_satisfied THEN
      v_status := 'completed';
    ELSE
      v_status := 'terminated';
    END IF;

    UPDATE public.first_thirty_progress p
    SET
      status = v_status,
      finished_reason = v_reason,
      completed_at = CASE WHEN v_status = 'completed' THEN timezone('utc', now()) ELSE p.completed_at END,
      terminated_at = CASE WHEN v_status = 'terminated' THEN timezone('utc', now()) ELSE p.terminated_at END,
      updated_at = timezone('utc', now())
    WHERE p.profile_id = v_progress.profile_id
    RETURNING * INTO v_progress;

    RETURN v_progress;
  END IF;

  IF v_all_satisfied THEN
    UPDATE public.first_thirty_progress p
    SET
      status = 'completed',
      finished_reason = COALESCE(p.finished_reason, 'milestones_complete'),
      completed_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
    WHERE p.profile_id = v_progress.profile_id
    RETURNING * INTO v_progress;
  END IF;

  RETURN v_progress;
END;
$$;

-- ---------------------------------------------------------------------------
-- apply_first_thirty_camp_exchange
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_first_thirty_camp_exchange(
  p_assistant_message_id uuid
)
RETURNS TABLE (
  active boolean,
  completed boolean,
  terminated boolean,
  greenwood_open boolean,
  eligible_camp_exchanges integer,
  first_camp_satisfied boolean,
  third_camp_satisfied boolean,
  first_deed_satisfied boolean,
  onboarding_leaf_granted integer,
  lifetime_leaf bigint,
  leaf_until_greenwood integer,
  next_milestone text,
  counted boolean,
  newly_satisfied_milestone text,
  newly_satisfied boolean,
  nominal_grant integer,
  actual_grant integer,
  first_thirty_suppressed_camp boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_msg public.camp_messages%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_progress public.first_thirty_progress%ROWTYPE;
  v_lifetime bigint;
  v_threshold integer;
  v_is_greenwood boolean;
  v_eligible boolean;
  v_existing_exchange public.first_thirty_camp_exchanges%ROWTYPE;
  v_actual integer;
  v_ledger_id uuid;
  v_newly_milestone text := NULL;
  v_newly boolean := false;
  v_nominal integer := 0;
  v_grant integer := 0;
  v_counted boolean := false;
  v_next text;
BEGIN
  IF p_assistant_message_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: assistant_message_id required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_msg
  FROM public.camp_messages m
  WHERE m.id = p_assistant_message_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_MESSAGE_NOT_FOUND: camp message missing'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_msg.role IS DISTINCT FROM 'assistant' THEN
    RAISE EXCEPTION 'FENN_VALIDATION: first thirty requires assistant message'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles p
  WHERE p.id = v_msg.profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_PROFILE_NOT_FOUND: profile missing'
      USING ERRCODE = 'P0002';
  END IF;

  v_threshold := public.first_thirty_greenwood_threshold();
  v_lifetime := public.first_thirty_lifetime_leaf(v_profile.id);
  v_is_greenwood := v_profile.greenwood_entered_at IS NOT NULL;

  SELECT * INTO v_progress
  FROM public.first_thirty_progress p
  WHERE p.profile_id = v_profile.id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF v_is_greenwood OR v_lifetime >= v_threshold THEN
      -- No path; ordinary camp may run.
      active := false;
      completed := false;
      terminated := true;
      greenwood_open := v_is_greenwood OR v_lifetime >= v_threshold;
      eligible_camp_exchanges := 0;
      first_camp_satisfied := false;
      third_camp_satisfied := false;
      first_deed_satisfied := false;
      onboarding_leaf_granted := 0;
      lifetime_leaf := v_lifetime;
      leaf_until_greenwood := GREATEST(0, v_threshold - v_lifetime::integer);
      next_milestone := NULL;
      counted := false;
      newly_satisfied_milestone := NULL;
      newly_satisfied := false;
      nominal_grant := 0;
      actual_grant := 0;
      first_thirty_suppressed_camp := false;
      RETURN NEXT;
      RETURN;
    END IF;

    INSERT INTO public.first_thirty_progress (profile_id, status)
    VALUES (v_profile.id, 'active')
    RETURNING * INTO v_progress;
  END IF;

  v_progress := public.first_thirty_close_if_needed(
    v_progress,
    v_lifetime,
    v_threshold,
    v_is_greenwood
  );

  -- Already processed this assistant message.
  SELECT * INTO v_existing_exchange
  FROM public.first_thirty_camp_exchanges e
  WHERE e.assistant_message_id = v_msg.id
  FOR UPDATE;

  IF FOUND THEN
    v_counted := v_existing_exchange.eligible;
  ELSIF v_progress.status = 'active' THEN
    v_eligible := COALESCE(v_msg.reward_recommendation, 0) >= 1;

    INSERT INTO public.first_thirty_camp_exchanges (
      profile_id,
      assistant_message_id,
      eligible
    )
    VALUES (v_profile.id, v_msg.id, v_eligible);

    v_counted := v_eligible;

    IF v_eligible THEN
      UPDATE public.first_thirty_progress p
      SET
        eligible_camp_exchange_count = p.eligible_camp_exchange_count + 1,
        updated_at = timezone('utc', now())
      WHERE p.profile_id = v_profile.id
      RETURNING * INTO v_progress;

      -- Milestone 1
      IF v_progress.eligible_camp_exchange_count >= 1
         AND v_progress.first_camp_satisfied_at IS NULL THEN
        v_lifetime := public.first_thirty_lifetime_leaf(v_profile.id);
        v_actual := LEAST(10, GREATEST(0, v_threshold - v_lifetime::integer));
        v_nominal := 10;
        v_ledger_id := public.first_thirty_insert_grant(
          v_profile.id,
          v_profile.wallet_address,
          'camp_first',
          v_actual,
          v_threshold,
          v_lifetime,
          v_msg.id::text,
          'THE FIRST THIRTY: first Camp exchange',
          jsonb_build_object('assistantMessageId', v_msg.id)
        );
        UPDATE public.first_thirty_progress p
        SET
          first_camp_satisfied_at = timezone('utc', now()),
          first_camp_leaf_granted = v_actual,
          onboarding_leaf_granted = p.onboarding_leaf_granted + v_actual,
          first_eligible_message_id = COALESCE(p.first_eligible_message_id, v_msg.id),
          updated_at = timezone('utc', now())
        WHERE p.profile_id = v_profile.id
        RETURNING * INTO v_progress;
        v_newly_milestone := 'camp_first';
        v_newly := true;
        v_grant := v_actual;
        v_lifetime := public.first_thirty_lifetime_leaf(v_profile.id);
        v_progress := public.first_thirty_close_if_needed(
          v_progress, v_lifetime, v_threshold, v_is_greenwood
        );
      END IF;

      -- Milestone 2 — third eligible exchange (while still active)
      IF v_progress.status = 'active'
         AND v_progress.eligible_camp_exchange_count >= 3
         AND v_progress.third_camp_satisfied_at IS NULL THEN
        v_lifetime := public.first_thirty_lifetime_leaf(v_profile.id);
        v_actual := LEAST(10, GREATEST(0, v_threshold - v_lifetime::integer));
        v_ledger_id := public.first_thirty_insert_grant(
          v_profile.id,
          v_profile.wallet_address,
          'camp_three',
          v_actual,
          v_threshold,
          v_lifetime,
          v_msg.id::text,
          'THE FIRST THIRTY: third Camp exchange',
          jsonb_build_object('assistantMessageId', v_msg.id)
        );
        UPDATE public.first_thirty_progress p
        SET
          third_camp_satisfied_at = timezone('utc', now()),
          third_camp_leaf_granted = v_actual,
          onboarding_leaf_granted = p.onboarding_leaf_granted + v_actual,
          third_eligible_message_id = COALESCE(p.third_eligible_message_id, v_msg.id),
          updated_at = timezone('utc', now())
        WHERE p.profile_id = v_profile.id
        RETURNING * INTO v_progress;

        IF v_newly_milestone IS NULL THEN
          v_newly_milestone := 'camp_three';
          v_newly := true;
          v_nominal := 10;
          v_grant := v_actual;
        END IF;

        v_lifetime := public.first_thirty_lifetime_leaf(v_profile.id);
        SELECT (greenwood_entered_at IS NOT NULL) INTO v_is_greenwood
        FROM public.profiles WHERE id = v_profile.id;
        v_progress := public.first_thirty_close_if_needed(
          v_progress, v_lifetime, v_threshold, v_is_greenwood
        );
      END IF;
    END IF;
  END IF;

  v_lifetime := public.first_thirty_lifetime_leaf(v_profile.id);
  SELECT (greenwood_entered_at IS NOT NULL) INTO v_is_greenwood
  FROM public.profiles WHERE id = v_profile.id;
  v_progress := public.first_thirty_close_if_needed(
    v_progress, v_lifetime, v_threshold, v_is_greenwood
  );

  IF v_progress.first_camp_satisfied_at IS NULL THEN
    v_next := 'first_camp';
  ELSIF v_progress.third_camp_satisfied_at IS NULL THEN
    v_next := 'third_camp';
  ELSIF v_progress.first_deed_satisfied_at IS NULL THEN
    v_next := 'first_deed';
  ELSE
    v_next := NULL;
  END IF;

  IF v_progress.status IS DISTINCT FROM 'active' THEN
    v_next := NULL;
  END IF;

  active := v_progress.status = 'active';
  completed := v_progress.status = 'completed';
  terminated := v_progress.status = 'terminated';
  greenwood_open := v_is_greenwood OR v_lifetime >= v_threshold;
  eligible_camp_exchanges := v_progress.eligible_camp_exchange_count;
  first_camp_satisfied := v_progress.first_camp_satisfied_at IS NOT NULL;
  third_camp_satisfied := v_progress.third_camp_satisfied_at IS NOT NULL;
  first_deed_satisfied := v_progress.first_deed_satisfied_at IS NOT NULL;
  onboarding_leaf_granted := v_progress.onboarding_leaf_granted;
  lifetime_leaf := v_lifetime;
  leaf_until_greenwood := GREATEST(0, v_threshold - v_lifetime::integer);
  next_milestone := v_next;
  counted := v_counted;
  newly_satisfied_milestone := v_newly_milestone;
  newly_satisfied := v_newly;
  nominal_grant := CASE WHEN v_newly THEN v_nominal ELSE 0 END;
  actual_grant := v_grant;
  first_thirty_suppressed_camp := v_progress.status = 'active';
  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- apply_first_thirty_first_deed
-- Call AFTER approve_deed_submission finalised Deed LEAF.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_first_thirty_first_deed(
  p_profile_id uuid,
  p_submission_id uuid
)
RETURNS TABLE (
  active boolean,
  completed boolean,
  terminated boolean,
  greenwood_open boolean,
  eligible_camp_exchanges integer,
  first_camp_satisfied boolean,
  third_camp_satisfied boolean,
  first_deed_satisfied boolean,
  onboarding_leaf_granted integer,
  lifetime_leaf bigint,
  leaf_until_greenwood integer,
  next_milestone text,
  newly_satisfied_milestone text,
  newly_satisfied boolean,
  nominal_grant integer,
  actual_grant integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_progress public.first_thirty_progress%ROWTYPE;
  v_lifetime bigint;
  v_threshold integer;
  v_is_greenwood boolean;
  v_actual integer;
  v_newly boolean := false;
  v_grant integer := 0;
  v_next text;
BEGIN
  IF p_profile_id IS NULL OR p_submission_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: profile_id and submission_id required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles p
  WHERE p.id = p_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_PROFILE_NOT_FOUND: profile missing'
      USING ERRCODE = 'P0002';
  END IF;

  v_threshold := public.first_thirty_greenwood_threshold();
  v_lifetime := public.first_thirty_lifetime_leaf(v_profile.id);
  v_is_greenwood := v_profile.greenwood_entered_at IS NOT NULL;

  SELECT * INTO v_progress
  FROM public.first_thirty_progress p
  WHERE p.profile_id = v_profile.id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF v_is_greenwood OR v_lifetime >= v_threshold THEN
      active := false;
      completed := false;
      terminated := true;
      greenwood_open := true;
      eligible_camp_exchanges := 0;
      first_camp_satisfied := false;
      third_camp_satisfied := false;
      first_deed_satisfied := false;
      onboarding_leaf_granted := 0;
      lifetime_leaf := v_lifetime;
      leaf_until_greenwood := 0;
      next_milestone := NULL;
      newly_satisfied_milestone := NULL;
      newly_satisfied := false;
      nominal_grant := 0;
      actual_grant := 0;
      RETURN NEXT;
      RETURN;
    END IF;

    INSERT INTO public.first_thirty_progress (profile_id, status)
    VALUES (v_profile.id, 'active')
    RETURNING * INTO v_progress;
  END IF;

  v_progress := public.first_thirty_close_if_needed(
    v_progress, v_lifetime, v_threshold, v_is_greenwood
  );

  IF v_progress.status = 'active'
     AND v_progress.first_deed_satisfied_at IS NULL THEN
    -- Recalculate lifetime AFTER deed LEAF (caller must have already inserted deed award).
    v_lifetime := public.first_thirty_lifetime_leaf(v_profile.id);
    v_actual := LEAST(10, GREATEST(0, v_threshold - v_lifetime::integer));

    PERFORM public.first_thirty_insert_grant(
      v_profile.id,
      v_profile.wallet_address,
      'first_deed',
      v_actual,
      v_threshold,
      v_lifetime,
      p_submission_id::text,
      'THE FIRST THIRTY: first approved Deed',
      jsonb_build_object('submissionId', p_submission_id)
    );

    UPDATE public.first_thirty_progress p
    SET
      first_deed_satisfied_at = timezone('utc', now()),
      first_deed_leaf_granted = v_actual,
      onboarding_leaf_granted = p.onboarding_leaf_granted + v_actual,
      first_deed_submission_id = COALESCE(p.first_deed_submission_id, p_submission_id),
      updated_at = timezone('utc', now())
    WHERE p.profile_id = v_profile.id
    RETURNING * INTO v_progress;

    v_newly := true;
    v_grant := v_actual;
    v_lifetime := public.first_thirty_lifetime_leaf(v_profile.id);
    SELECT (greenwood_entered_at IS NOT NULL) INTO v_is_greenwood
    FROM public.profiles WHERE id = v_profile.id;
    v_progress := public.first_thirty_close_if_needed(
      v_progress, v_lifetime, v_threshold, v_is_greenwood
    );
  END IF;

  v_lifetime := public.first_thirty_lifetime_leaf(v_profile.id);
  SELECT (greenwood_entered_at IS NOT NULL) INTO v_is_greenwood
  FROM public.profiles WHERE id = v_profile.id;
  v_progress := public.first_thirty_close_if_needed(
    v_progress, v_lifetime, v_threshold, v_is_greenwood
  );

  IF v_progress.first_camp_satisfied_at IS NULL THEN
    v_next := 'first_camp';
  ELSIF v_progress.third_camp_satisfied_at IS NULL THEN
    v_next := 'third_camp';
  ELSIF v_progress.first_deed_satisfied_at IS NULL THEN
    v_next := 'first_deed';
  ELSE
    v_next := NULL;
  END IF;
  IF v_progress.status IS DISTINCT FROM 'active' THEN
    v_next := NULL;
  END IF;

  active := v_progress.status = 'active';
  completed := v_progress.status = 'completed';
  terminated := v_progress.status = 'terminated';
  greenwood_open := v_is_greenwood OR v_lifetime >= v_threshold;
  eligible_camp_exchanges := v_progress.eligible_camp_exchange_count;
  first_camp_satisfied := v_progress.first_camp_satisfied_at IS NOT NULL;
  third_camp_satisfied := v_progress.third_camp_satisfied_at IS NOT NULL;
  first_deed_satisfied := v_progress.first_deed_satisfied_at IS NOT NULL;
  onboarding_leaf_granted := v_progress.onboarding_leaf_granted;
  lifetime_leaf := v_lifetime;
  leaf_until_greenwood := GREATEST(0, v_threshold - v_lifetime::integer);
  next_milestone := v_next;
  newly_satisfied_milestone := CASE WHEN v_newly THEN 'first_deed' ELSE NULL END;
  newly_satisfied := v_newly;
  nominal_grant := CASE WHEN v_newly THEN 10 ELSE 0 END;
  actual_grant := v_grant;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.apply_first_thirty_camp_exchange(uuid) IS
  'Count eligible CAMP exchange for First Thirty; award camp_first/camp_three with cap to Greenwood threshold. service_role only.';

COMMENT ON FUNCTION public.apply_first_thirty_first_deed(uuid, uuid) IS
  'Satisfy first_deed milestone after Deed approval LEAF; grant remainder only. service_role only.';

REVOKE ALL ON FUNCTION public.first_thirty_greenwood_threshold() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.first_thirty_lifetime_leaf(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.first_thirty_insert_grant(uuid, text, text, integer, integer, bigint, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.first_thirty_close_if_needed(public.first_thirty_progress, bigint, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_first_thirty_camp_exchange(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_first_thirty_first_deed(uuid, uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.apply_first_thirty_camp_exchange(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_first_thirty_first_deed(uuid, uuid) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_first_thirty_camp_exchange(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_first_thirty_first_deed(uuid, uuid) TO service_role;

-- Helper functions stay executable by service_role (owners / superuser via migration).
GRANT EXECUTE ON FUNCTION public.first_thirty_greenwood_threshold() TO service_role;
GRANT EXECUTE ON FUNCTION public.first_thirty_lifetime_leaf(uuid) TO service_role;
