-- FENN Living Greenwood 2 — Verification for Fire presence
--
-- PREREQUISITE: apply migration first:
--   supabase/migrations/20260801110000_34_living_greenwood_2_presence.sql
--
-- Then run this verify file.

-- ---------------------------------------------------------------------------
-- A) Table + privileges
-- ---------------------------------------------------------------------------
SELECT
  c.relname,
  c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'greenwood_presence';
-- expect rls_enabled = true

SELECT
  p.proname,
  r.rolname AS grantee,
  has_function_privilege(r.oid, p.oid, 'EXECUTE') AS can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN pg_roles r
WHERE n.nspname = 'public'
  AND p.proname IN (
    'heartbeat_greenwood_presence',
    'sit_greenwood_presence',
    'leave_greenwood_presence'
  )
  AND r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY p.proname, r.rolname;
-- anon/authenticated: false; service_role: true

-- ---------------------------------------------------------------------------
-- B) Behavioural checks (rolled back)
-- ---------------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_profile_id uuid;
  v_non uuid;
  v_wallet text := '0xdddddddddddddddddddddddddddddddddddddddd';
  r1 record;
  r2 record;
  r3 record;
  r4 record;
BEGIN
  INSERT INTO public.profiles (
    wallet_address,
    leaf_lifetime_earned,
    greenwood_entered_at,
    greenwood_threshold_at_entry,
    greenwood_lifetime_leaf_at_entry
  ) VALUES (
    v_wallet,
    40,
    timezone('utc', now()),
    30,
    40
  )
  RETURNING id INTO v_profile_id;

  SELECT * INTO r1 FROM public.heartbeat_greenwood_presence(v_profile_id);
  IF r1.sitting IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'VERIFY FAIL: heartbeat must not sit';
  END IF;

  SELECT * INTO r2 FROM public.heartbeat_greenwood_presence(v_profile_id);
  IF (
    SELECT count(*) FROM public.greenwood_presence WHERE profile_id = v_profile_id
  ) <> 1 THEN
    RAISE EXCEPTION 'VERIFY FAIL: duplicate presence rows';
  END IF;

  SELECT * INTO r3 FROM public.sit_greenwood_presence(v_profile_id);
  IF r3.sitting IS DISTINCT FROM true OR r3.sitting_since IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAIL: sit must set sitting + sitting_since';
  END IF;

  SELECT * INTO r4 FROM public.sit_greenwood_presence(v_profile_id);
  IF r4.sitting_since IS DISTINCT FROM r3.sitting_since THEN
    RAISE EXCEPTION 'VERIFY FAIL: sit must preserve sitting_since';
  END IF;

  SELECT * INTO r1 FROM public.leave_greenwood_presence(v_profile_id);
  IF r1.sitting IS DISTINCT FROM false OR r1.sitting_since IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY FAIL: leave must clear sitting';
  END IF;

  INSERT INTO public.profiles (wallet_address)
  VALUES ('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')
  RETURNING id INTO v_non;

  BEGIN
    PERFORM public.heartbeat_greenwood_presence(v_non);
    RAISE EXCEPTION 'VERIFY FAIL: non-member heartbeat must fail';
  EXCEPTION
    WHEN others THEN
      IF SQLERRM LIKE 'VERIFY FAIL:%' THEN
        RAISE;
      END IF;
      IF SQLERRM NOT LIKE '%FENN_GREENWOOD_MEMBERSHIP_REQUIRED%' THEN
        RAISE;
      END IF;
  END;
END
$$;

ROLLBACK;
