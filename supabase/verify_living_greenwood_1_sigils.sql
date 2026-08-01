-- FENN Living Greenwood 1 — Verification for ASCII sigil foundation
--
-- PREREQUISITE: apply migration first:
--   supabase/migrations/20260801100000_33_living_greenwood_1_sigils.sql
--
-- Then run this verify file.

-- ---------------------------------------------------------------------------
-- A) Catalogue counts
-- ---------------------------------------------------------------------------
SELECT
  count(*) FILTER (WHERE is_fallback = false) AS curated_count,
  count(*) FILTER (WHERE is_fallback = true) AS fallback_count,
  count(*) FILTER (WHERE status = 'active' AND is_fallback = false) AS active_curated
FROM public.greenwood_sigil_catalogue;
-- expect curated_count = 64, fallback_count = 1, active_curated = 64

DO $$
DECLARE
  v_curated integer;
  v_fallback integer;
BEGIN
  SELECT
    count(*) FILTER (WHERE is_fallback = false),
    count(*) FILTER (WHERE is_fallback = true)
  INTO v_curated, v_fallback
  FROM public.greenwood_sigil_catalogue;

  IF v_curated IS DISTINCT FROM 64 THEN
    RAISE EXCEPTION 'VERIFY FAIL: expected 64 curated sigils, got %', v_curated;
  END IF;
  IF v_fallback IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'VERIFY FAIL: expected 1 fallback sigil, got %', v_fallback;
  END IF;
END
$$;

SELECT slug, is_fallback, sort_order
FROM public.greenwood_sigil_catalogue
WHERE slug = 'unmarked';
-- expect one row, is_fallback true, sort_order 0

-- ---------------------------------------------------------------------------
-- B) Privileges
-- ---------------------------------------------------------------------------
SELECT
  p.proname,
  r.rolname AS grantee,
  has_function_privilege(r.oid, p.oid, 'EXECUTE') AS can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN pg_roles r
WHERE n.nspname = 'public'
  AND p.proname IN ('assign_greenwood_sigil', 'backfill_greenwood_sigils')
  AND r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY p.proname, r.rolname;
-- anon/authenticated: false; service_role: true

-- ---------------------------------------------------------------------------
-- C) Member coverage + integrity
-- ---------------------------------------------------------------------------
-- Every Greenwood member has exactly one assignment
SELECT
  (SELECT count(*) FROM public.profiles WHERE greenwood_entered_at IS NOT NULL)
    AS member_count,
  (SELECT count(*) FROM public.greenwood_sigil_assignments a
     JOIN public.profiles p ON p.id = a.profile_id
    WHERE p.greenwood_entered_at IS NOT NULL)
    AS member_assignments;

DO $$
DECLARE
  v_members integer;
  v_assigned integer;
  v_dup_sigils integer;
  v_orphan_profiles integer;
  v_orphan_sigils integer;
  v_non_member_assignments integer;
BEGIN
  SELECT count(*) INTO v_members
  FROM public.profiles
  WHERE greenwood_entered_at IS NOT NULL;

  SELECT count(*) INTO v_assigned
  FROM public.greenwood_sigil_assignments a
  JOIN public.profiles p ON p.id = a.profile_id
  WHERE p.greenwood_entered_at IS NOT NULL;

  IF v_members <> v_assigned THEN
    RAISE EXCEPTION
      'VERIFY FAIL: member/assignment mismatch members=% assigned=%',
      v_members, v_assigned;
  END IF;

  SELECT count(*) INTO v_dup_sigils
  FROM (
    SELECT sigil_id
    FROM public.greenwood_sigil_assignments
    WHERE sigil_id <> 'a0000000-0000-4000-8000-000000000000'::uuid
    GROUP BY sigil_id
    HAVING count(*) > 1
  ) d;

  IF v_dup_sigils <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAIL: non-fallback sigil assigned to multiple profiles';
  END IF;

  SELECT count(*) INTO v_orphan_profiles
  FROM public.greenwood_sigil_assignments a
  LEFT JOIN public.profiles p ON p.id = a.profile_id
  WHERE p.id IS NULL;

  SELECT count(*) INTO v_orphan_sigils
  FROM public.greenwood_sigil_assignments a
  LEFT JOIN public.greenwood_sigil_catalogue c ON c.id = a.sigil_id
  WHERE c.id IS NULL;

  IF v_orphan_profiles <> 0 OR v_orphan_sigils <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAIL: orphan assignment rows present';
  END IF;

  SELECT count(*) INTO v_non_member_assignments
  FROM public.greenwood_sigil_assignments a
  JOIN public.profiles p ON p.id = a.profile_id
  WHERE p.greenwood_entered_at IS NULL;

  IF v_non_member_assignments <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAIL: non-members have sigil assignments';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- D) Behavioural checks (rolled back)
-- ---------------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_profile_id uuid;
  v_wallet text := '0xcccccccccccccccccccccccccccccccccccccccc';
  r1 record;
  r2 record;
  v_sigil_a uuid;
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

  SELECT * INTO r1 FROM public.assign_greenwood_sigil(v_profile_id, 'system');
  IF r1.newly_assigned IS NOT TRUE THEN
    RAISE EXCEPTION 'VERIFY FAIL: first assign should be newly_assigned';
  END IF;
  IF r1.is_fallback IS TRUE THEN
    RAISE EXCEPTION 'VERIFY FAIL: first assign should not be UNMARKED while pool open';
  END IF;
  v_sigil_a := r1.sigil_id;

  SELECT * INTO r2 FROM public.assign_greenwood_sigil(v_profile_id, 'system');
  IF r2.newly_assigned IS NOT FALSE THEN
    RAISE EXCEPTION 'VERIFY FAIL: second assign must be idempotent';
  END IF;
  IF r2.sigil_id IS DISTINCT FROM v_sigil_a THEN
    RAISE EXCEPTION 'VERIFY FAIL: idempotent assign changed sigil';
  END IF;
END
$$;

ROLLBACK;
