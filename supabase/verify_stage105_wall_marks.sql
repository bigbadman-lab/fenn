-- FENN Stage 10.5.3 — Verification for wall_marks
--
-- PREREQUISITE: apply
--   supabase/migrations/20260723160000_17_stage105_wall_entries.sql
--   supabase/migrations/20260723170000_18_stage105_wall_marks.sql
--
-- Read-only catalog checks + optional rollback-safe mutation probes.
-- Does not require Robinhood Chain / X / OpenAI / LEAF.

-- ---------------------------------------------------------------------------
-- A) Table present + RLS
-- ---------------------------------------------------------------------------
SELECT
  'A_TABLE_RLS' AS section,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  CASE WHEN c.relrowsecurity THEN 'OK' ELSE 'FAIL' END AS status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'wall_marks';

-- ---------------------------------------------------------------------------
-- B) Required columns / forbidden extras
-- ---------------------------------------------------------------------------
SELECT
  'B_REQUIRED_COLUMNS' AS section,
  ec.column_name,
  CASE WHEN c.column_name IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM (
  VALUES
    ('id'),
    ('entry_id'),
    ('profile_id'),
    ('created_at')
) AS ec(column_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = 'wall_marks'
 AND c.column_name = ec.column_name
ORDER BY status DESC, ec.column_name;

SELECT
  'B_FORBIDDEN_COLUMNS' AS section,
  t.column_name,
  CASE
    WHEN c.column_name IS NULL THEN 'OK_ABSENT'
    ELSE 'UNEXPECTED_PRESENT'
  END AS status
FROM (
  VALUES
    ('emoji'),
    ('reaction'),
    ('comment'),
    ('body'),
    ('score'),
    ('removed_at')
) AS t(column_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = 'wall_marks'
 AND c.column_name = t.column_name
ORDER BY status DESC, t.column_name;

-- ---------------------------------------------------------------------------
-- C) Unique (entry_id, profile_id) + FKs
-- ---------------------------------------------------------------------------
SELECT
  'C_UNIQUE_ENTRY_PROFILE' AS section,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_indexes i
      WHERE i.schemaname = 'public'
        AND i.indexname = 'wall_marks_entry_profile_uidx'
        AND i.indexdef ILIKE '%UNIQUE%'
        AND i.indexdef ILIKE '%entry_id%'
        AND i.indexdef ILIKE '%profile_id%'
    ) THEN 'OK'
    ELSE 'MISSING'
  END AS status;

SELECT
  'C_FK_ENTRY' AS section,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public'
        AND c.contype = 'f'
        AND c.conrelid = 'public.wall_marks'::regclass
        AND pg_get_constraintdef(c.oid) ILIKE '%entry_id%wall_entries%'
    ) THEN 'OK'
    ELSE 'MISSING'
  END AS status;

SELECT
  'C_FK_PROFILE' AS section,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public'
        AND c.contype = 'f'
        AND c.conrelid = 'public.wall_marks'::regclass
        AND pg_get_constraintdef(c.oid) ILIKE '%profile_id%profiles%'
    ) THEN 'OK'
    ELSE 'MISSING'
  END AS status;

-- ---------------------------------------------------------------------------
-- D) Append-only triggers
-- ---------------------------------------------------------------------------
SELECT
  'D_APPEND_ONLY_TRIGGERS' AS section,
  expected.tgname,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'wall_marks'
        AND NOT t.tgisinternal
        AND t.tgname = expected.tgname
    ) THEN 'OK'
    ELSE 'MISSING'
  END AS status
FROM (
  VALUES
    ('wall_marks_prevent_update'),
    ('wall_marks_prevent_delete')
) AS expected(tgname);

-- ---------------------------------------------------------------------------
-- E) Browser roles cannot mutate or select raw marks
-- ---------------------------------------------------------------------------
SELECT
  'E_BROWSER_PRIVILEGES' AS section,
  r.rolname,
  p.privilege_type,
  CASE
    WHEN has_table_privilege(r.rolname, 'public.wall_marks', p.privilege_type)
      THEN 'UNEXPECTED_GRANT'
    ELSE 'OK_REVOKED'
  END AS status
FROM (
  VALUES ('anon'), ('authenticated')
) AS r(rolname)
CROSS JOIN (
  VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
) AS p(privilege_type)
ORDER BY r.rolname, p.privilege_type;

-- ---------------------------------------------------------------------------
-- F) Optional functional probe (always rolled back)
-- ---------------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_entry uuid;
  v_profile uuid;
  v_mark uuid;
  v_dup boolean := false;
BEGIN
  SELECT id INTO v_entry FROM public.wall_entries LIMIT 1;
  SELECT id INTO v_profile FROM public.profiles LIMIT 1;

  IF v_entry IS NULL OR v_profile IS NULL THEN
    RAISE NOTICE 'F_PROBE_SKIPPED: need at least one wall_entries + profiles row';
    RETURN;
  END IF;

  INSERT INTO public.wall_marks (entry_id, profile_id)
  VALUES (v_entry, v_profile)
  RETURNING id INTO v_mark;

  BEGIN
    INSERT INTO public.wall_marks (entry_id, profile_id)
    VALUES (v_entry, v_profile);
  EXCEPTION WHEN unique_violation THEN
    v_dup := true;
  END;

  IF NOT v_dup THEN
    RAISE EXCEPTION 'F_PROBE_FAIL: unique (entry_id, profile_id) not enforced';
  END IF;

  BEGIN
    UPDATE public.wall_marks SET created_at = timezone('utc', now()) WHERE id = v_mark;
    RAISE EXCEPTION 'F_PROBE_FAIL: UPDATE should be blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%append-only%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    DELETE FROM public.wall_marks WHERE id = v_mark;
    RAISE EXCEPTION 'F_PROBE_FAIL: DELETE should be blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%append-only%' THEN
      RAISE;
    END IF;
  END;

  RAISE NOTICE 'F_PROBE_OK: unique + append-only verified (will rollback)';
END $$;

ROLLBACK;
