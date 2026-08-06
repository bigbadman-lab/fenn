-- Verify Stage 3 Chronicler fact memory + wall candidate column
-- Run manually against the local/prod database after migration.

DO $$
DECLARE
  v_exists boolean;
  v_unique boolean;
  v_col boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'x_wall_fact_memories'
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'VERIFY FAIL: x_wall_fact_memories missing';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'x_wall_fact_memories_key_fp_uidx'
  ) INTO v_unique;
  IF NOT v_unique THEN
    RAISE EXCEPTION 'VERIFY FAIL: unique (fact_key, fact_fingerprint) missing';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'x_perception_judgements'
      AND column_name = 'final_wall_candidate'
  ) INTO v_col;
  IF NOT v_col THEN
    RAISE EXCEPTION 'VERIFY FAIL: final_wall_candidate column missing';
  END IF;

  -- Two different fingerprints for same key OK
  INSERT INTO public.x_wall_fact_memories (fact_key, fact_fingerprint, reason)
  VALUES
    ('confirmed_outlaw_count', 'confirmed_outlaw_count:v=2', 'milestone_reached'),
    ('confirmed_outlaw_count', 'confirmed_outlaw_count:v=3', 'milestone_reached');

  -- Duplicate fingerprint rejected
  BEGIN
    INSERT INTO public.x_wall_fact_memories (fact_key, fact_fingerprint, reason)
    VALUES ('confirmed_outlaw_count', 'confirmed_outlaw_count:v=2', 'milestone_reached');
    RAISE EXCEPTION 'VERIFY FAIL: expected unique violation on duplicate fingerprint';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  -- Same fingerprint string under different keys accepted (composite uniqueness)
  INSERT INTO public.x_wall_fact_memories (fact_key, fact_fingerprint, reason)
  VALUES ('greenwood_member_count', 'confirmed_outlaw_count:v=2', 'first_observation');

  -- Cleanup verify rows
  DELETE FROM public.x_wall_fact_memories
  WHERE fact_fingerprint IN (
    'confirmed_outlaw_count:v=2',
    'confirmed_outlaw_count:v=3'
  )
  OR (fact_key = 'greenwood_member_count' AND fact_fingerprint = 'confirmed_outlaw_count:v=2');

  RAISE NOTICE 'VERIFY OK: stage3 chronicler wall memory';
END $$;

-- RLS posture: table exists and RLS enabled
SELECT
  c.relname,
  c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'x_wall_fact_memories';
