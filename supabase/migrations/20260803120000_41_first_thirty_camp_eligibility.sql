-- Migration 41: First Thirty onboarding eligibility on CAMP messages
-- Separates arrival participation from long-term reward_recommendation.

ALTER TABLE public.camp_messages
  ADD COLUMN IF NOT EXISTS first_thirty_eligible boolean,
  ADD COLUMN IF NOT EXISTS first_thirty_eligibility_reason text;

COMMENT ON COLUMN public.camp_messages.first_thirty_eligible IS
  'Trusted First Thirty participation decision for this assistant turn (user contribution). Set only by server. NULL = legacy/unset; RPC treats NULL as not eligible.';

COMMENT ON COLUMN public.camp_messages.first_thirty_eligibility_reason IS
  'Fixed internal reason code: eligible | substance | repeated | reward_gaming | spam | quality | relevance | empty. Not member-facing.';

-- Conservative backfill: legacy rows do not count retroactively.
UPDATE public.camp_messages
SET
  first_thirty_eligible = false,
  first_thirty_eligibility_reason = COALESCE(first_thirty_eligibility_reason, 'empty')
WHERE role = 'assistant'
  AND first_thirty_eligible IS NULL;

-- ---------------------------------------------------------------------------
-- Eligibility: trusted first_thirty_eligible column only
-- (reward_recommendation remains ordinary long-term CAMP LEAF policy)
-- Full function body mirrors migration 40 with the eligibility line changed.
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

  SELECT * INTO v_existing_exchange
  FROM public.first_thirty_camp_exchanges e
  WHERE e.assistant_message_id = v_msg.id
  FOR UPDATE;

  IF FOUND THEN
    v_counted := v_existing_exchange.eligible;
  ELSIF v_progress.status = 'active' THEN
    -- Trusted column only — never client-supplied, never pure reward_recommendation.
    v_eligible := COALESCE(v_msg.first_thirty_eligible, false);

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

COMMENT ON FUNCTION public.apply_first_thirty_camp_exchange(uuid) IS
  'Count First Thirty CAMP exchange from first_thirty_eligible (not reward_recommendation). Exact-once per assistant message.';
