-- FENN Living Greenwood 3 — Verification for Gatherings + Raise Hand
--
-- PREREQUISITE: apply migration first:
--   supabase/migrations/20260801130000_36_living_greenwood_3_gatherings.sql
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
    'greenwood_gatherings',
    'greenwood_gathering_attendance',
    'greenwood_gathering_hands'
  )
ORDER BY c.relname;
-- expect rls_enabled = true for all three

SELECT
  p.proname,
  r.rolname AS grantee,
  has_function_privilege(r.oid, p.oid, 'EXECUTE') AS can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN pg_roles r
WHERE n.nspname = 'public'
  AND p.proname IN (
    'raise_greenwood_gathering_hand',
    'lower_greenwood_gathering_hand',
    'prevent_overlapping_fire_gatherings'
  )
  AND r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY p.proname, r.rolname;
-- raise/lower: anon/authenticated false; service_role true

-- ---------------------------------------------------------------------------
-- B) Behavioural checks (rolled back)
-- ---------------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_member uuid;
  v_member2 uuid;
  v_non uuid;
  v_g1 uuid;
  v_g2 uuid;
  v_draft_a uuid;
  v_draft_b uuid;
  v_cap uuid;
  r1 record;
  r2 record;
  v_att_count integer;
  v_hand_open integer;
BEGIN
  INSERT INTO public.profiles (
    wallet_address,
    leaf_lifetime_earned,
    greenwood_entered_at,
    greenwood_threshold_at_entry,
    greenwood_lifetime_leaf_at_entry
  ) VALUES (
    '0xf111111111111111111111111111111111111111',
    40,
    timezone('utc', now()),
    30,
    40
  )
  RETURNING id INTO v_member;

  INSERT INTO public.profiles (
    wallet_address,
    leaf_lifetime_earned,
    greenwood_entered_at,
    greenwood_threshold_at_entry,
    greenwood_lifetime_leaf_at_entry
  ) VALUES (
    '0xf222222222222222222222222222222222222222',
    40,
    timezone('utc', now()),
    30,
    40
  )
  RETURNING id INTO v_member2;

  INSERT INTO public.profiles (wallet_address)
  VALUES ('0xf333333333333333333333333333333333333333')
  RETURNING id INTO v_non;

  -- Drafts may overlap
  INSERT INTO public.greenwood_gatherings (
    title, slug, summary, starts_at, ends_at, status, created_by_actor_id
  ) VALUES (
    'Draft A',
    'draft-a-verify',
    'overlap ok',
    timezone('utc', now()) + interval '1 hour',
    timezone('utc', now()) + interval '2 hours',
    'draft',
    'verify-admin'
  )
  RETURNING id INTO v_draft_a;

  INSERT INTO public.greenwood_gatherings (
    title, slug, summary, starts_at, ends_at, status, created_by_actor_id
  ) VALUES (
    'Draft B',
    'draft-b-verify',
    'overlap ok',
    timezone('utc', now()) + interval '1 hour',
    timezone('utc', now()) + interval '2 hours',
    'draft',
    'verify-admin'
  )
  RETURNING id INTO v_draft_b;

  -- Publish first Gathering for an active window
  INSERT INTO public.greenwood_gatherings (
    title, slug, summary, starts_at, ends_at, status, created_by_actor_id
  ) VALUES (
    'Active Gathering',
    'active-verify',
    'raise a hand',
    timezone('utc', now()) - interval '5 minutes',
    timezone('utc', now()) + interval '1 hour',
    'scheduled',
    'verify-admin'
  )
  RETURNING id INTO v_g1;

  -- Overlapping published Gathering must fail
  BEGIN
    INSERT INTO public.greenwood_gatherings (
      title, slug, summary, starts_at, ends_at, status, created_by_actor_id
    ) VALUES (
      'Overlap Bad',
      'overlap-bad-verify',
      'should fail',
      timezone('utc', now()) + interval '10 minutes',
      timezone('utc', now()) + interval '90 minutes',
      'scheduled',
      'verify-admin'
    );
    RAISE EXCEPTION 'VERIFY FAIL: overlapping published Gathering must be rejected';
  EXCEPTION
    WHEN others THEN
      IF SQLERRM LIKE 'VERIFY FAIL:%' THEN
        RAISE;
      END IF;
      IF SQLERRM NOT LIKE '%FENN_GATHERING_OVERLAP%' THEN
        RAISE;
      END IF;
  END;

  -- Non-overlapping future published Gathering is allowed
  INSERT INTO public.greenwood_gatherings (
    title, slug, summary, starts_at, ends_at, status, created_by_actor_id
  ) VALUES (
    'Later Gathering',
    'later-verify',
    'after first',
    timezone('utc', now()) + interval '2 hours',
    timezone('utc', now()) + interval '3 hours',
    'scheduled',
    'verify-admin'
  )
  RETURNING id INTO v_g2;

  -- Non-member cannot raise
  BEGIN
    PERFORM public.raise_greenwood_gathering_hand(v_g1, v_non);
    RAISE EXCEPTION 'VERIFY FAIL: non-member raise must fail';
  EXCEPTION
    WHEN others THEN
      IF SQLERRM LIKE 'VERIFY FAIL:%' THEN
        RAISE;
      END IF;
      IF SQLERRM NOT LIKE '%FENN_GREENWOOD_MEMBERSHIP_REQUIRED%' THEN
        RAISE;
      END IF;
  END;

  -- Draft interaction denied
  BEGIN
    PERFORM public.raise_greenwood_gathering_hand(v_draft_a, v_member);
    RAISE EXCEPTION 'VERIFY FAIL: draft raise must fail';
  EXCEPTION
    WHEN others THEN
      IF SQLERRM LIKE 'VERIFY FAIL:%' THEN
        RAISE;
      END IF;
      IF SQLERRM NOT LIKE '%FENN_GATHERING_NOT_VISIBLE%' THEN
        RAISE;
      END IF;
  END;

  -- Raise hand (active window)
  SELECT * INTO r1 FROM public.raise_greenwood_gathering_hand(v_g1, v_member);
  IF r1.newly_raised IS DISTINCT FROM true OR r1.hand_count <> 1 THEN
    RAISE EXCEPTION 'VERIFY FAIL: first raise must create open hand';
  END IF;

  -- Idempotent raise
  SELECT * INTO r2 FROM public.raise_greenwood_gathering_hand(v_g1, v_member);
  IF r2.newly_raised IS DISTINCT FROM false OR r2.hand_count <> 1 THEN
    RAISE EXCEPTION 'VERIFY FAIL: repeated raise must be idempotent';
  END IF;

  SELECT count(*) INTO v_att_count
  FROM public.greenwood_gathering_attendance
  WHERE gathering_id = v_g1 AND profile_id = v_member;
  IF v_att_count <> 1 THEN
    RAISE EXCEPTION 'VERIFY FAIL: attendance must be one row';
  END IF;

  -- Second member raise
  PERFORM public.raise_greenwood_gathering_hand(v_g1, v_member2);

  -- Lower hand; attendance remains
  SELECT * INTO r1 FROM public.lower_greenwood_gathering_hand(v_g1, v_member);
  IF r1.newly_lowered IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'VERIFY FAIL: lower must mark lowered_at';
  END IF;

  SELECT count(*) INTO v_att_count
  FROM public.greenwood_gathering_attendance
  WHERE gathering_id = v_g1 AND profile_id = v_member;
  IF v_att_count <> 1 THEN
    RAISE EXCEPTION 'VERIFY FAIL: lower must not delete attendance';
  END IF;

  SELECT count(*) INTO v_hand_open
  FROM public.greenwood_gathering_hands
  WHERE gathering_id = v_g1 AND profile_id = v_member AND lowered_at IS NULL;
  IF v_hand_open <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAIL: open hand must be cleared after lower';
  END IF;

  -- Idempotent lower
  SELECT * INTO r2 FROM public.lower_greenwood_gathering_hand(v_g1, v_member);
  IF r2.newly_lowered IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'VERIFY FAIL: repeated lower must be idempotent';
  END IF;

  -- Re-raise during active window
  SELECT * INTO r1 FROM public.raise_greenwood_gathering_hand(v_g1, v_member);
  IF r1.newly_raised IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'VERIFY FAIL: re-raise must create a new open hand';
  END IF;

  SELECT count(*) INTO v_att_count
  FROM public.greenwood_gathering_attendance
  WHERE gathering_id = v_g1 AND profile_id = v_member;
  IF v_att_count <> 1 THEN
    RAISE EXCEPTION 'VERIFY FAIL: re-raise must not duplicate attendance';
  END IF;

  -- Free Fire window for capacity Gathering
  PERFORM public.lower_greenwood_gathering_hand(v_g1, v_member);
  PERFORM public.lower_greenwood_gathering_hand(v_g1, v_member2);

  UPDATE public.greenwood_gatherings
  SET status = 'cancelled', cancelled_at = timezone('utc', now())
  WHERE id IN (v_g1, v_g2);

  INSERT INTO public.greenwood_gatherings (
    title, slug, summary, starts_at, ends_at, status, capacity, created_by_actor_id
  ) VALUES (
    'Capacity Gathering',
    'capacity-verify',
    'one seat',
    timezone('utc', now()) - interval '1 minute',
    timezone('utc', now()) + interval '30 minutes',
    'scheduled',
    1,
    'verify-admin'
  )
  RETURNING id INTO v_cap;

  PERFORM public.raise_greenwood_gathering_hand(v_cap, v_member);

  BEGIN
    PERFORM public.raise_greenwood_gathering_hand(v_cap, v_member2);
    RAISE EXCEPTION 'VERIFY FAIL: capacity must reject second open hand';
  EXCEPTION
    WHEN others THEN
      IF SQLERRM LIKE 'VERIFY FAIL:%' THEN
        RAISE;
      END IF;
      IF SQLERRM NOT LIKE '%FENN_GATHERING_FULL%' THEN
        RAISE;
      END IF;
  END;

  -- Lower frees capacity
  PERFORM public.lower_greenwood_gathering_hand(v_cap, v_member);
  PERFORM public.raise_greenwood_gathering_hand(v_cap, v_member2);

  -- Closed Gathering rejects raise
  UPDATE public.greenwood_gatherings
  SET status = 'closed', closed_at = timezone('utc', now())
  WHERE id = v_cap;

  BEGIN
    PERFORM public.raise_greenwood_gathering_hand(v_cap, v_member);
    RAISE EXCEPTION 'VERIFY FAIL: closed Gathering must reject raise';
  EXCEPTION
    WHEN others THEN
      IF SQLERRM LIKE 'VERIFY FAIL:%' THEN
        RAISE;
      END IF;
      IF SQLERRM NOT LIKE '%FENN_GATHERING_CLOSED%' THEN
        RAISE;
      END IF;
  END;

  -- Future-only Gathering rejects raise (not active yet)
  INSERT INTO public.greenwood_gatherings (
    title, slug, summary, starts_at, ends_at, status, created_by_actor_id
  ) VALUES (
    'Future Only',
    'future-verify',
    'not yet',
    timezone('utc', now()) + interval '4 hours',
    timezone('utc', now()) + interval '5 hours',
    'scheduled',
    'verify-admin'
  )
  RETURNING id INTO v_g2;

  BEGIN
    PERFORM public.raise_greenwood_gathering_hand(v_g2, v_member);
    RAISE EXCEPTION 'VERIFY FAIL: pre-start raise must fail';
  EXCEPTION
    WHEN others THEN
      IF SQLERRM LIKE 'VERIFY FAIL:%' THEN
        RAISE;
      END IF;
      IF SQLERRM NOT LIKE '%FENN_GATHERING_NOT_ACTIVE%' THEN
        RAISE;
      END IF;
  END;
END
$$;

ROLLBACK;
