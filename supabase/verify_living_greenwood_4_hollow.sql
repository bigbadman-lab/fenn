-- FENN Living Greenwood 4 — Verification for The Hollow + reward campaigns
--
-- PREREQUISITE: apply migration first:
--   supabase/migrations/20260801140000_37_living_greenwood_4_hollow.sql
--
-- Then run this verify file.

-- ---------------------------------------------------------------------------
-- A) Tables + privileges
-- ---------------------------------------------------------------------------
SELECT
  c.relname,
  c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'greenwood_reward_campaigns',
    'greenwood_reward_campaign_recipients',
    'greenwood_hollow_rewards'
  )
ORDER BY c.relname;

SELECT
  p.proname,
  r.rolname AS grantee,
  has_function_privilege(r.oid, p.oid, 'EXECUTE') AS can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN pg_roles r
WHERE n.nspname = 'public'
  AND p.proname = 'claim_greenwood_hollow_leaf'
  AND r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY r.rolname;
-- anon/authenticated: false; service_role: true

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'leaf_ledger_source_type_check';
-- expect hollow included

-- ---------------------------------------------------------------------------
-- B) Behavioural checks (rolled back)
-- ---------------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_member uuid;
  v_member2 uuid;
  v_non uuid;
  v_g uuid;
  v_hand uuid;
  v_campaign uuid;
  v_recipient uuid;
  v_reward uuid;
  v_reward2 uuid;
  r1 record;
  v_balance_before bigint;
  v_balance_after bigint;
  v_ledger_count integer;
BEGIN
  INSERT INTO public.profiles (
    wallet_address,
    leaf_lifetime_earned,
    leaf_balance,
    greenwood_entered_at,
    greenwood_threshold_at_entry,
    greenwood_lifetime_leaf_at_entry
  ) VALUES (
    '0xfa11111111111111111111111111111111111111',
    40,
    40,
    timezone('utc', now()),
    30,
    40
  )
  RETURNING id INTO v_member;

  INSERT INTO public.profiles (
    wallet_address,
    leaf_lifetime_earned,
    leaf_balance,
    greenwood_entered_at,
    greenwood_threshold_at_entry,
    greenwood_lifetime_leaf_at_entry
  ) VALUES (
    '0xfa22222222222222222222222222222222222222',
    40,
    40,
    timezone('utc', now()),
    30,
    40
  )
  RETURNING id INTO v_member2;

  INSERT INTO public.profiles (wallet_address)
  VALUES ('0xfa33333333333333333333333333333333333333')
  RETURNING id INTO v_non;

  INSERT INTO public.greenwood_gatherings (
    title, slug, summary, starts_at, ends_at, status, closed_at, created_by_actor_id
  ) VALUES (
    'Closed Gathering',
    'hollow-verify-gathering',
    'closed for snapshot',
    timezone('utc', now()) - interval '2 hours',
    timezone('utc', now()) - interval '1 hour',
    'closed',
    timezone('utc', now()) - interval '1 hour',
    'verify-admin'
  )
  RETURNING id INTO v_g;

  -- Open hand for member1
  INSERT INTO public.greenwood_gathering_hands (
    gathering_id, profile_id, raised_at
  ) VALUES (
    v_g, v_member, timezone('utc', now()) - interval '90 minutes'
  )
  RETURNING id INTO v_hand;

  -- Lowered hand for member2 (must be excluded)
  INSERT INTO public.greenwood_gathering_hands (
    gathering_id, profile_id, raised_at, lowered_at
  ) VALUES (
    v_g,
    v_member2,
    timezone('utc', now()) - interval '90 minutes',
    timezone('utc', now()) - interval '70 minutes'
  );

  -- Attendance-only without open hand should not matter; member2 has attendance
  INSERT INTO public.greenwood_gathering_attendance (
    gathering_id, profile_id, attendance_source
  ) VALUES (
    v_g, v_member2, 'raise_hand'
  );

  INSERT INTO public.greenwood_reward_campaigns (
    title,
    reason,
    reward_type,
    amount_per_recipient,
    recipient_rule,
    gathering_id,
    status,
    created_by_actor_id
  ) VALUES (
    'Hollow LEAF',
    'final hands',
    'leaf',
    25,
    'gathering_open_hands',
    v_g,
    'draft',
    'verify-admin'
  )
  RETURNING id INTO v_campaign;

  -- Resolve snapshot manually (mirrors app resolve)
  INSERT INTO public.greenwood_reward_campaign_recipients (
    campaign_id,
    profile_id,
    wallet_address_snapshot,
    eligibility_source,
    eligibility_source_id,
    status
  )
  SELECT
    v_campaign,
    h.profile_id,
    NULL,
    'gathering_open_hand',
    h.id::text,
    'ready'
  FROM public.greenwood_gathering_hands h
  WHERE h.gathering_id = v_g
    AND h.lowered_at IS NULL;

  IF (
    SELECT count(*) FROM public.greenwood_reward_campaign_recipients
    WHERE campaign_id = v_campaign
  ) <> 1 THEN
    RAISE EXCEPTION 'VERIFY FAIL: open-hand snapshot must exclude lowered hands';
  END IF;

  SELECT id INTO v_recipient
  FROM public.greenwood_reward_campaign_recipients
  WHERE campaign_id = v_campaign
  LIMIT 1;

  INSERT INTO public.greenwood_hollow_rewards (
    campaign_id,
    campaign_recipient_id,
    profile_id,
    reward_type,
    title,
    reason,
    amount,
    status,
    available_at,
    idempotency_key
  ) VALUES (
    v_campaign,
    v_recipient,
    v_member,
    'leaf',
    'Hollow LEAF',
    'final hands',
    25,
    'available',
    timezone('utc', now()),
    'hollow_campaign:' || v_campaign::text || ':recipient:' || v_member::text
  )
  RETURNING id INTO v_reward;

  UPDATE public.greenwood_reward_campaigns
  SET status = 'available', recipient_count = 1, total_amount = 25,
      resolved_at = timezone('utc', now()), executed_at = timezone('utc', now())
  WHERE id = v_campaign;

  SELECT leaf_balance INTO v_balance_before FROM public.profiles WHERE id = v_member;

  -- Non-owner cannot claim
  BEGIN
    PERFORM public.claim_greenwood_hollow_leaf(v_reward, v_member2);
    RAISE EXCEPTION 'VERIFY FAIL: non-owner claim must fail';
  EXCEPTION
    WHEN others THEN
      IF SQLERRM LIKE 'VERIFY FAIL:%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%FENN_HOLLOW_FORBIDDEN%' THEN RAISE; END IF;
  END;

  -- Non-member cannot claim
  BEGIN
    PERFORM public.claim_greenwood_hollow_leaf(v_reward, v_non);
    RAISE EXCEPTION 'VERIFY FAIL: non-member claim must fail';
  EXCEPTION
    WHEN others THEN
      IF SQLERRM LIKE 'VERIFY FAIL:%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%FENN_GREENWOOD_MEMBERSHIP_REQUIRED%' THEN RAISE; END IF;
  END;

  SELECT * INTO r1 FROM public.claim_greenwood_hollow_leaf(v_reward, v_member);
  IF r1.newly_claimed IS DISTINCT FROM true OR r1.amount <> 25 THEN
    RAISE EXCEPTION 'VERIFY FAIL: first claim must award 25 LEAF';
  END IF;

  SELECT leaf_balance INTO v_balance_after FROM public.profiles WHERE id = v_member;
  IF v_balance_after <> v_balance_before + 25 THEN
    RAISE EXCEPTION 'VERIFY FAIL: balance must increase by 25';
  END IF;

  SELECT count(*) INTO v_ledger_count
  FROM public.leaf_ledger
  WHERE source_type = 'hollow'
    AND source_id = v_reward::text;
  IF v_ledger_count <> 1 THEN
    RAISE EXCEPTION 'VERIFY FAIL: exactly one hollow ledger row expected';
  END IF;

  -- Idempotent claim
  SELECT * INTO r1 FROM public.claim_greenwood_hollow_leaf(v_reward, v_member);
  IF r1.newly_claimed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'VERIFY FAIL: repeated claim must be idempotent';
  END IF;

  SELECT count(*) INTO v_ledger_count
  FROM public.leaf_ledger
  WHERE source_type = 'hollow'
    AND source_id = v_reward::text;
  IF v_ledger_count <> 1 THEN
    RAISE EXCEPTION 'VERIFY FAIL: claim retry must not duplicate ledger';
  END IF;

  -- Sent requires transaction hash (constraint)
  INSERT INTO public.greenwood_hollow_rewards (
    profile_id,
    reward_type,
    title,
    reason,
    amount,
    asset_symbol,
    asset_chain_id,
    wallet_address_snapshot,
    status,
    available_at,
    idempotency_key
  ) VALUES (
    v_member2,
    'eth',
    'ETH gift',
    'manual',
    1,
    'ETH',
    1,
    '0xfa22222222222222222222222222222222222222',
    'awaiting_send',
    timezone('utc', now()),
    'hollow_eth_verify_1'
  )
  RETURNING id INTO v_reward2;

  BEGIN
    UPDATE public.greenwood_hollow_rewards
    SET status = 'sent'
    WHERE id = v_reward2;
    RAISE EXCEPTION 'VERIFY FAIL: sent without tx hash must fail';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
    WHEN others THEN
      IF SQLERRM LIKE 'VERIFY FAIL:%' THEN RAISE; END IF;
      RAISE;
  END;

  UPDATE public.greenwood_hollow_rewards
  SET
    status = 'sent',
    transaction_hash = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    sent_at = timezone('utc', now())
  WHERE id = v_reward2;
END
$$;

ROLLBACK;
