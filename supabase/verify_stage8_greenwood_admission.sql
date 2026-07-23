-- FENN Stage 8.1 — Verification for Greenwood admission foundation
--
-- PREREQUISITE: apply this migration FIRST in the SQL Editor:
--   supabase/migrations/20260723150000_16_stage8_greenwood_admission.sql
--
-- Then run this verify file.
-- Uses a single transaction + ROLLBACK so disposable rows do not persist.
-- Requires roles/tables present in the local Supabase project.

-- ---------------------------------------------------------------------------
-- A) Configuration
-- ---------------------------------------------------------------------------
SELECT key, value, jsonb_typeof(value) AS value_type
FROM public.app_settings
WHERE key = 'greenwood.lifetime_leaf_threshold';
-- expect value = 30 (jsonb number)

DO $$
DECLARE
  v jsonb;
  n integer;
BEGIN
  SELECT value INTO v
  FROM public.app_settings
  WHERE key = 'greenwood.lifetime_leaf_threshold';

  IF v IS NULL THEN
    RAISE EXCEPTION
      'VERIFY FAIL: greenwood.lifetime_leaf_threshold missing — apply migration 20260723150000_16_stage8_greenwood_admission.sql first';
  END IF;
  IF jsonb_typeof(v) IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'VERIFY FAIL: threshold must be bare JSON number, got %', jsonb_typeof(v);
  END IF;
  n := (v #>> '{}')::integer;
  IF n IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'VERIFY FAIL: threshold expected 30, got %', n;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- B) Execute privileges (service_role only)
-- ---------------------------------------------------------------------------
SELECT
  p.proname,
  r.rolname AS grantee,
  has_function_privilege(r.oid, p.oid, 'EXECUTE') AS can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN pg_roles r
WHERE n.nspname = 'public'
  AND p.proname = 'admit_to_greenwood'
  AND r.rolname IN ('anon', 'authenticated', 'service_role', 'postgres')
ORDER BY r.rolname;
-- anon/authenticated: false; service_role: true

SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer,
       p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'admit_to_greenwood';
-- expect SECURITY INVOKER, search_path=public

-- ---------------------------------------------------------------------------
-- C) Behavioural checks (rolled back)
-- ---------------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_profile_id uuid;
  v_wallet text := '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  r record;
  v_entered timestamptz;
  v_thr integer;
  v_life bigint;
  v_saved_threshold jsonb;
BEGIN
  -- Disposable profile (no LEAF yet).
  INSERT INTO public.profiles (wallet_address)
  VALUES (v_wallet)
  RETURNING id INTO v_profile_id;

  -- C1) Ineligible
  SELECT * INTO r FROM public.admit_to_greenwood(v_profile_id);
  IF r.status IS DISTINCT FROM 'not_eligible' THEN
    RAISE EXCEPTION 'VERIFY FAIL: expected not_eligible, got %', r.status;
  END IF;
  IF r.newly_admitted IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'VERIFY FAIL: not_eligible must set newly_admitted=false';
  END IF;
  IF r.threshold IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'VERIFY FAIL: not_eligible threshold expected 30';
  END IF;
  IF r.lifetime_leaf IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'VERIFY FAIL: not_eligible lifetime expected 0, got %', r.lifetime_leaf;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_profile_id
      AND (
        p.greenwood_entered_at IS NOT NULL
        OR p.greenwood_threshold_at_entry IS NOT NULL
        OR p.greenwood_lifetime_leaf_at_entry IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'VERIFY FAIL: Greenwood fields must remain NULL when not_eligible';
  END IF;

  -- Fund lifetime LEAF via ledger (authoritative path). Amount=30, lifetime_delta=30.
  INSERT INTO public.leaf_ledger (
    profile_id,
    wallet_address,
    amount,
    lifetime_delta,
    source_type,
    source_id,
    reason,
    actor_type,
    actor_id,
    idempotency_key
  ) VALUES (
    v_profile_id,
    v_wallet,
    30,
    30,
    'system',
    'stage8_verify',
    'Stage 8.1 verification grant',
    'system',
    'stage8.verify',
    'system:stage8-verify:' || v_profile_id::text
  );

  -- C2) Eligible → admitted
  SELECT * INTO r FROM public.admit_to_greenwood(v_profile_id);
  IF r.status IS DISTINCT FROM 'admitted' THEN
    RAISE EXCEPTION 'VERIFY FAIL: expected admitted, got %', r.status;
  END IF;
  IF r.newly_admitted IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'VERIFY FAIL: first admit must set newly_admitted=true';
  END IF;
  IF r.threshold IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'VERIFY FAIL: admitted threshold expected 30';
  END IF;
  IF r.lifetime_leaf IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'VERIFY FAIL: admitted lifetime expected 30, got %', r.lifetime_leaf;
  END IF;
  IF r.greenwood_entered_at IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAIL: admitted must populate greenwood_entered_at';
  END IF;
  IF r.greenwood_threshold_at_entry IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'VERIFY FAIL: snapshot threshold expected 30';
  END IF;
  IF r.greenwood_lifetime_leaf_at_entry IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'VERIFY FAIL: snapshot lifetime expected 30';
  END IF;

  SELECT
    p.greenwood_entered_at,
    p.greenwood_threshold_at_entry,
    p.greenwood_lifetime_leaf_at_entry
  INTO v_entered, v_thr, v_life
  FROM public.profiles p
  WHERE p.id = v_profile_id;

  IF v_entered IS NULL OR v_thr IS DISTINCT FROM 30 OR v_life IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'VERIFY FAIL: profile snapshot incomplete after admit';
  END IF;

  -- C3) Retry → already_member, snapshots unchanged
  SELECT * INTO r FROM public.admit_to_greenwood(v_profile_id);
  IF r.status IS DISTINCT FROM 'already_member' THEN
    RAISE EXCEPTION 'VERIFY FAIL: retry expected already_member, got %', r.status;
  END IF;
  IF r.newly_admitted IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'VERIFY FAIL: retry must set newly_admitted=false';
  END IF;
  IF r.greenwood_entered_at IS DISTINCT FROM v_entered THEN
    RAISE EXCEPTION 'VERIFY FAIL: retry mutated greenwood_entered_at';
  END IF;
  IF r.greenwood_threshold_at_entry IS DISTINCT FROM v_thr THEN
    RAISE EXCEPTION 'VERIFY FAIL: retry mutated threshold snapshot';
  END IF;
  IF r.greenwood_lifetime_leaf_at_entry IS DISTINCT FROM v_life THEN
    RAISE EXCEPTION 'VERIFY FAIL: retry mutated lifetime snapshot';
  END IF;

  -- C4) Threshold increase after admission must not rewrite member snapshot
  SELECT value INTO v_saved_threshold
  FROM public.app_settings
  WHERE key = 'greenwood.lifetime_leaf_threshold';

  UPDATE public.app_settings
  SET value = '999'::jsonb
  WHERE key = 'greenwood.lifetime_leaf_threshold';

  SELECT * INTO r FROM public.admit_to_greenwood(v_profile_id);
  IF r.status IS DISTINCT FROM 'already_member' THEN
    RAISE EXCEPTION 'VERIFY FAIL: after threshold raise expected already_member';
  END IF;
  IF r.greenwood_threshold_at_entry IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'VERIFY FAIL: threshold raise rewrote snapshot';
  END IF;
  IF r.greenwood_entered_at IS DISTINCT FROM v_entered THEN
    RAISE EXCEPTION 'VERIFY FAIL: threshold raise mutated entered_at';
  END IF;

  -- Restore setting inside this txn (still rolled back overall).
  UPDATE public.app_settings
  SET value = v_saved_threshold
  WHERE key = 'greenwood.lifetime_leaf_threshold';

  -- C5) Write-once trigger blocks direct snapshot mutation
  BEGIN
    UPDATE public.profiles
    SET greenwood_threshold_at_entry = 1
    WHERE id = v_profile_id;
    RAISE EXCEPTION 'VERIFY FAIL: expected immutable snapshot trigger to fire';
  EXCEPTION
    WHEN others THEN
      IF SQLERRM NOT ILIKE '%FENN_GREENWOOD_IMMUTABLE%' THEN
        RAISE EXCEPTION 'VERIFY FAIL: unexpected error mutating snapshot: %', SQLERRM;
      END IF;
  END;

  -- C6) Snapshot all-or-nothing still holds for this member
  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_profile_id
      AND NOT (
        (
          p.greenwood_entered_at IS NULL
          AND p.greenwood_threshold_at_entry IS NULL
          AND p.greenwood_lifetime_leaf_at_entry IS NULL
        )
        OR (
          p.greenwood_entered_at IS NOT NULL
          AND p.greenwood_threshold_at_entry IS NOT NULL
          AND p.greenwood_lifetime_leaf_at_entry IS NOT NULL
        )
      )
  ) THEN
    RAISE EXCEPTION 'VERIFY FAIL: greenwood snapshot all-or-nothing violated';
  END IF;

  RAISE NOTICE 'Stage 8.1 admit_to_greenwood behavioural checks passed';
END
$$;

ROLLBACK;

-- ---------------------------------------------------------------------------
-- D) Missing profile fails closed
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    PERFORM * FROM public.admit_to_greenwood(
      '00000000-0000-4000-8000-000000000099'::uuid
    );
    RAISE EXCEPTION 'VERIFY FAIL: missing profile should error';
  EXCEPTION
    WHEN others THEN
      IF SQLERRM NOT ILIKE '%FENN_PROFILE_NOT_FOUND%' THEN
        RAISE EXCEPTION 'VERIFY FAIL: unexpected missing-profile error: %', SQLERRM;
      END IF;
  END;
END
$$;
