-- FENN Stage 7.4 — Additive: Camp LEAF reward caps + transactional grant RPC
-- LOCAL ONLY — do not apply until explicitly authorised.
-- Does not modify prior migration files.
--
-- Purpose: make Camp rewards economically real under concurrency by coordinating
-- recommendation → caps/cooldown → leaf_ledger → camp_messages → camp_daily_rewards
-- in ONE Postgres transaction. Preserves Stage 4 leaf_ledger semantics
-- (append-only, profile cache via existing trigger, canonical idempotency key).
--
-- Trusted server/service-role path only. Does NOT authenticate end users.
-- Caller (Next.js) must authorize the Camp turn before invoking.

-- ---------------------------------------------------------------------------
-- Seed / lock MVP caps (canonical configuration)
-- ---------------------------------------------------------------------------
UPDATE public.camp_characters
SET
  daily_leaf_cap = 5,
  updated_at = timezone('utc', now())
WHERE slug IN ('fenn', 'wren', 'rook');

INSERT INTO public.app_settings (key, value, description)
VALUES
  (
    'camp.global_daily_leaf_cap',
    '10'::jsonb,
    'Maximum LEAF a profile may earn from Camp across all characters in one UTC day.'
  ),
  (
    'camp.reward_cooldown_seconds',
    '60'::jsonb,
    'Minimum seconds between rewarded Camp turns for the same profile (anti-farming).'
  )
ON CONFLICT (key) DO UPDATE
SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  updated_at = timezone('utc', now());

-- ---------------------------------------------------------------------------
-- public.grant_camp_message_reward
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_camp_message_reward(
  p_message_id uuid,
  p_reward_date date DEFAULT NULL
)
RETURNS TABLE (
  recommended integer,
  actual_grant integer,
  reason text,
  character_daily_granted integer,
  global_daily_granted integer,
  ledger_id uuid,
  finalized boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_msg public.camp_messages%ROWTYPE;
  v_character public.camp_characters%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_session public.camp_sessions%ROWTYPE;
  v_global public.camp_daily_rewards%ROWTYPE;
  v_char_daily public.camp_daily_rewards%ROWTYPE;
  v_existing_ledger public.leaf_ledger%ROWTYPE;
  v_ledger public.leaf_ledger%ROWTYPE;
  v_reward_date date;
  v_key text;
  v_recommended integer;
  v_actual integer;
  v_reason text;
  v_character_cap integer;
  v_global_cap integer;
  v_cooldown_seconds integer;
  v_char_remaining integer;
  v_global_remaining integer;
  v_last_rewarded_at timestamptz;
  v_setting jsonb;
  v_flags jsonb;
  v_prior_policy jsonb;
BEGIN
  IF p_message_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: message_id required'
      USING ERRCODE = '22023';
  END IF;

  -- Lock the evaluated assistant turn first.
  SELECT *
  INTO v_msg
  FROM public.camp_messages m
  WHERE m.id = p_message_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_MESSAGE_NOT_FOUND: camp message missing'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_msg.role IS DISTINCT FROM 'assistant' THEN
    RAISE EXCEPTION 'FENN_VALIDATION: reward requires assistant message'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_session
  FROM public.camp_sessions s
  WHERE s.id = v_msg.session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_VALIDATION: camp session missing'
      USING ERRCODE = '22023';
  END IF;

  IF v_session.profile_id IS DISTINCT FROM v_msg.profile_id
     OR v_session.character_id IS DISTINCT FROM v_msg.character_id THEN
    RAISE EXCEPTION 'FENN_VALIDATION: message/session mismatch'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_character
  FROM public.camp_characters c
  WHERE c.id = v_msg.character_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_VALIDATION: camp character missing'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = v_msg.profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_PROFILE_NOT_FOUND: profile missing'
      USING ERRCODE = 'P0002';
  END IF;

  v_flags := COALESCE(v_msg.moderation_flags, '{}'::jsonb);
  v_prior_policy := v_flags -> 'rewardPolicy';

  -- Idempotent replay: already finalized (including 0-LEAF decisions).
  IF v_prior_policy IS NOT NULL
     AND jsonb_typeof(v_prior_policy) = 'object'
     AND (v_prior_policy ? 'actual') THEN
    recommended := GREATEST(
      0,
      LEAST(3, COALESCE((v_prior_policy ->> 'recommended')::integer, 0))
    );
    actual_grant := GREATEST(0, COALESCE((v_prior_policy ->> 'actual')::integer, v_msg.reward_granted));
    reason := COALESCE(v_prior_policy ->> 'reason', 'already_granted');
    ledger_id := v_msg.leaf_ledger_id;
    finalized := false;

    SELECT COALESCE(leaf_granted, 0)
    INTO character_daily_granted
    FROM public.camp_daily_rewards
    WHERE profile_id = v_msg.profile_id
      AND reward_date = COALESCE(
        p_reward_date,
        (timezone('utc', v_msg.created_at))::date
      )
      AND character_id = v_msg.character_id;

    SELECT COALESCE(leaf_granted, 0)
    INTO global_daily_granted
    FROM public.camp_daily_rewards
    WHERE profile_id = v_msg.profile_id
      AND reward_date = COALESCE(
        p_reward_date,
        (timezone('utc', v_msg.created_at))::date
      )
      AND character_id IS NULL;

    character_daily_granted := COALESCE(character_daily_granted, 0);
    global_daily_granted := COALESCE(global_daily_granted, 0);
    RETURN NEXT;
    RETURN;
  END IF;

  -- Positive grant already applied without policy flag (legacy / interrupted).
  IF v_msg.reward_granted > 0 THEN
    recommended := GREATEST(
      0,
      LEAST(3, COALESCE(v_msg.reward_recommendation, 0))
    );
    actual_grant := v_msg.reward_granted;
    reason := 'already_granted';
    ledger_id := v_msg.leaf_ledger_id;
    character_daily_granted := 0;
    global_daily_granted := 0;
    finalized := false;
    RETURN NEXT;
    RETURN;
  END IF;

  v_recommended := GREATEST(
    0,
    LEAST(3, COALESCE(v_msg.reward_recommendation, 0))
  );
  v_key := 'camp_message:' || v_msg.id::text || ':reward';

  -- Existing canonical ledger recovery (message still reward_granted = 0).
  SELECT *
  INTO v_existing_ledger
  FROM public.leaf_ledger l
  WHERE l.idempotency_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_ledger.profile_id IS DISTINCT FROM v_msg.profile_id THEN
      RAISE EXCEPTION 'FENN_LEDGER_CONFLICT: ledger profile mismatch'
        USING ERRCODE = '23505';
    END IF;
    IF v_existing_ledger.source_type IS DISTINCT FROM 'camp' THEN
      RAISE EXCEPTION 'FENN_LEDGER_CONFLICT: ledger source_type mismatch'
        USING ERRCODE = '22023';
    END IF;
    IF v_existing_ledger.source_id IS DISTINCT FROM v_msg.id::text THEN
      RAISE EXCEPTION 'FENN_LEDGER_CONFLICT: ledger source_id mismatch'
        USING ERRCODE = '22023';
    END IF;
    IF v_existing_ledger.amount <= 0 THEN
      RAISE EXCEPTION 'FENN_LEDGER_CONFLICT: existing ledger amount invalid'
        USING ERRCODE = '22023';
    END IF;

    -- Restore message linkage. Daily counters are NOT adjusted:
    -- without a message→counter linkage we cannot know if they already include
    -- this ledger. New grants are fully atomic and should not hit this path.
    v_actual := v_existing_ledger.amount::integer;
    v_reason := 'recovered';
    v_flags := v_flags || jsonb_build_object(
      'rewardPolicy',
      jsonb_build_object(
        'recommended', v_recommended,
        'actual', v_actual,
        'reason', v_reason,
        'recovery', true
      )
    );

    UPDATE public.camp_messages m
    SET
      reward_granted = v_actual,
      leaf_ledger_id = v_existing_ledger.id,
      moderation_flags = v_flags
    WHERE m.id = v_msg.id;

    recommended := v_recommended;
    actual_grant := v_actual;
    reason := v_reason;
    ledger_id := v_existing_ledger.id;
    character_daily_granted := 0;
    global_daily_granted := 0;
    finalized := true;
    RETURN NEXT;
    RETURN;
  END IF;

  v_reward_date := COALESCE(
    p_reward_date,
    (timezone('utc', now()))::date
  );

  -- Serialize all Camp reward decisions for this profile on this UTC day.
  -- Locks global + character daily rows under this advisory lock so concurrent
  -- messages (any character) cannot overshoot global cap or both pass cooldown.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'camp_reward:' || v_msg.profile_id::text || ':' || v_reward_date::text,
      7
    )
  );

  -- Caps / cooldown from authoritative config.
  v_character_cap := COALESCE(v_character.daily_leaf_cap, 0);

  SELECT s.value INTO v_setting
  FROM public.app_settings s
  WHERE s.key = 'camp.global_daily_leaf_cap';
  IF FOUND AND jsonb_typeof(v_setting) = 'number' THEN
    v_global_cap := GREATEST(0, (v_setting #>> '{}')::integer);
  ELSIF FOUND
        AND jsonb_typeof(v_setting) = 'object'
        AND (v_setting ? 'cap') THEN
    v_global_cap := GREATEST(0, (v_setting ->> 'cap')::integer);
  ELSE
    v_global_cap := 10;
  END IF;

  SELECT s.value INTO v_setting
  FROM public.app_settings s
  WHERE s.key = 'camp.reward_cooldown_seconds';
  IF FOUND AND jsonb_typeof(v_setting) = 'number' THEN
    v_cooldown_seconds := GREATEST(0, (v_setting #>> '{}')::integer);
  ELSIF FOUND
        AND jsonb_typeof(v_setting) = 'object'
        AND (v_setting ? 'seconds') THEN
    v_cooldown_seconds := GREATEST(0, (v_setting ->> 'seconds')::integer);
  ELSE
    v_cooldown_seconds := 60;
  END IF;

  INSERT INTO public.camp_daily_rewards (
    profile_id,
    reward_date,
    character_id,
    leaf_granted,
    rewarded_message_count
  )
  VALUES (
    v_msg.profile_id,
    v_reward_date,
    NULL,
    0,
    0
  )
  ON CONFLICT (profile_id, reward_date, character_id) DO NOTHING;

  SELECT *
  INTO v_global
  FROM public.camp_daily_rewards d
  WHERE d.profile_id = v_msg.profile_id
    AND d.reward_date = v_reward_date
    AND d.character_id IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_VALIDATION: global daily reward row missing'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.camp_daily_rewards (
    profile_id,
    reward_date,
    character_id,
    leaf_granted,
    rewarded_message_count
  )
  VALUES (
    v_msg.profile_id,
    v_reward_date,
    v_msg.character_id,
    0,
    0
  )
  ON CONFLICT (profile_id, reward_date, character_id) DO NOTHING;

  SELECT *
  INTO v_char_daily
  FROM public.camp_daily_rewards d
  WHERE d.profile_id = v_msg.profile_id
    AND d.reward_date = v_reward_date
    AND d.character_id = v_msg.character_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_VALIDATION: character daily reward row missing'
      USING ERRCODE = 'P0002';
  END IF;

  -- Cooldown: most recent prior rewarded assistant turn for this profile.
  SELECT m.created_at
  INTO v_last_rewarded_at
  FROM public.camp_messages m
  WHERE m.profile_id = v_msg.profile_id
    AND m.role = 'assistant'
    AND m.reward_granted > 0
    AND m.id IS DISTINCT FROM v_msg.id
  ORDER BY m.created_at DESC
  LIMIT 1;

  -- Policy (never increases above recommendation).
  IF v_recommended <= 0 THEN
    v_actual := 0;
    v_reason := 'not_recommended';
  ELSIF v_last_rewarded_at IS NOT NULL
        AND v_cooldown_seconds > 0
        AND v_last_rewarded_at > (timezone('utc', now()) - make_interval(secs => v_cooldown_seconds)) THEN
    v_actual := 0;
    v_reason := 'cooldown';
  ELSE
    v_char_remaining := GREATEST(0, v_character_cap - v_char_daily.leaf_granted);
    v_global_remaining := GREATEST(0, v_global_cap - v_global.leaf_granted);

    IF v_char_remaining <= 0 THEN
      v_actual := 0;
      v_reason := 'character_cap';
    ELSIF v_global_remaining <= 0 THEN
      v_actual := 0;
      v_reason := 'global_cap';
    ELSE
      v_actual := LEAST(v_recommended, v_char_remaining, v_global_remaining);
      IF v_actual < v_recommended THEN
        v_reason := 'cap_partial';
      ELSE
        v_reason := 'eligible';
      END IF;
    END IF;
  END IF;

  IF v_actual > v_recommended THEN
    v_actual := v_recommended;
  END IF;

  IF v_actual > 0 THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 2));

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
      v_msg.profile_id,
      v_profile.wallet_address,
      v_actual,
      v_actual,
      'camp',
      v_msg.id::text,
      v_msg.character_id::text,
      'Camp contribution: ' || left(v_character.display_name, 480),
      'system',
      'camp',
      v_key,
      jsonb_build_object(
        'messageId', v_msg.id,
        'sessionId', v_msg.session_id,
        'characterId', v_msg.character_id,
        'characterSlug', v_character.slug,
        'recommended', v_recommended,
        'reason', v_reason,
        'rewardDate', v_reward_date
      )
    )
    RETURNING * INTO v_ledger;

    UPDATE public.camp_daily_rewards d
    SET
      leaf_granted = leaf_granted + v_actual,
      rewarded_message_count = rewarded_message_count + 1,
      updated_at = timezone('utc', now())
    WHERE d.id = v_global.id
    RETURNING * INTO v_global;

    UPDATE public.camp_daily_rewards d
    SET
      leaf_granted = leaf_granted + v_actual,
      rewarded_message_count = rewarded_message_count + 1,
      updated_at = timezone('utc', now())
    WHERE d.id = v_char_daily.id
    RETURNING * INTO v_char_daily;
  END IF;

  v_flags := v_flags || jsonb_build_object(
    'rewardPolicy',
    jsonb_build_object(
      'recommended', v_recommended,
      'actual', v_actual,
      'reason', v_reason,
      'rewardDate', v_reward_date,
      'characterCap', v_character_cap,
      'globalCap', v_global_cap,
      'cooldownSeconds', v_cooldown_seconds
    )
  );

  UPDATE public.camp_messages m
  SET
    reward_granted = v_actual,
    leaf_ledger_id = CASE WHEN v_actual > 0 THEN v_ledger.id ELSE NULL END,
    moderation_flags = v_flags
  WHERE m.id = v_msg.id;

  recommended := v_recommended;
  actual_grant := v_actual;
  reason := v_reason;
  character_daily_granted := v_char_daily.leaf_granted;
  global_daily_granted := v_global.leaf_granted;
  ledger_id := CASE WHEN v_actual > 0 THEN v_ledger.id ELSE NULL END;
  finalized := true;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.grant_camp_message_reward(uuid, date) IS
  'Atomic Camp message reward: caps + cooldown + Stage 4 leaf_ledger + daily counters. service_role only. Never trusts client amounts.';

REVOKE ALL ON FUNCTION public.grant_camp_message_reward(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_camp_message_reward(uuid, date) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_camp_message_reward(uuid, date) TO service_role;
