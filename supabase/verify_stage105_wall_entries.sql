-- FENN Stage 10.5.1 — Verification for wall_entries
--
-- PREREQUISITE: apply
--   supabase/migrations/20260723160000_17_stage105_wall_entries.sql
--
-- Read-only catalog checks + optional rollback-safe mutation probes.
-- Does not require Robinhood Chain / X / OpenAI.

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
  AND c.relname = 'wall_entries';

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
    ('body'),
    ('source_type'),
    ('source_external_id'),
    ('created_at')
) AS ec(column_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = 'wall_entries'
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
    ('kind'),
    ('author'),
    ('profile_id'),
    ('visibility'),
    ('mark_count'),
    ('html_body')
) AS t(column_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = 'wall_entries'
 AND c.column_name = t.column_name
ORDER BY status DESC, t.column_name;

-- ---------------------------------------------------------------------------
-- C) Constraints / indexes
-- ---------------------------------------------------------------------------
SELECT
  'C_CONSTRAINTS' AS section,
  expected.name,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public' AND c.conname = expected.name
    ) OR EXISTS (
      SELECT 1 FROM pg_indexes i
      WHERE i.schemaname = 'public' AND i.indexname = expected.name
    ) THEN 'OK'
    ELSE 'MISSING'
  END AS status
FROM (
  VALUES
    ('wall_entries_body_nonempty'),
    ('wall_entries_body_max_length'),
    ('wall_entries_source_type_check'),
    ('wall_entries_source_provenance_uidx'),
    ('wall_entries_created_at_idx')
) AS expected(name)
ORDER BY status DESC, expected.name;

-- ---------------------------------------------------------------------------
-- D) Public SELECT policy present; no recipient-style lock needed
-- ---------------------------------------------------------------------------
SELECT
  'D_PUBLIC_SELECT_POLICY' AS section,
  policyname,
  cmd,
  roles::text AS roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'wall_entries'
  AND policyname = 'wall_entries_public_select';
-- expect SELECT for {anon,authenticated}

-- ---------------------------------------------------------------------------
-- E) Browser mutation grants must be absent
-- ---------------------------------------------------------------------------
SELECT
  'E_MUTATION_GRANT_VIOLATIONS' AS section,
  g.table_name,
  g.grantee,
  g.privilege_type,
  'FAIL_HAS_MUTATION_GRANT' AS status
FROM information_schema.role_table_grants g
WHERE g.table_schema = 'public'
  AND g.table_name = 'wall_entries'
  AND g.grantee IN ('anon', 'authenticated')
  AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
ORDER BY g.grantee, g.privilege_type;
-- expect zero rows

-- ---------------------------------------------------------------------------
-- F) Append-only triggers
-- ---------------------------------------------------------------------------
SELECT
  'F_APPEND_ONLY_TRIGGERS' AS section,
  expected.tgname,
  CASE
    WHEN t.tgname IS NOT NULL THEN 'OK'
    ELSE 'MISSING'
  END AS status
FROM (
  VALUES
    ('wall_entries_prevent_update'),
    ('wall_entries_prevent_delete')
) AS expected(tgname)
LEFT JOIN pg_trigger t
  ON t.tgname = expected.tgname
 AND NOT t.tgisinternal
ORDER BY status DESC, expected.tgname;

-- ---------------------------------------------------------------------------
-- G) Behavioural checks (rolled back)
-- ---------------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_id uuid;
  v_body text := E'      /\\\n     /  \\\n    /____\\';
  v_dup_id uuid;
BEGIN
  -- Valid insert
  INSERT INTO public.wall_entries (body, source_type, source_external_id)
  VALUES (v_body, 'system', NULL)
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAIL: insert returned no id';
  END IF;

  -- Empty body rejected
  BEGIN
    INSERT INTO public.wall_entries (body, source_type)
    VALUES ('   ', 'system');
    RAISE EXCEPTION 'VERIFY FAIL: empty body should be rejected';
  EXCEPTION
    WHEN check_violation THEN
      NULL; -- expected
  END;

  -- Overlong body rejected
  BEGIN
    INSERT INTO public.wall_entries (body, source_type)
    VALUES (repeat('a', 4001), 'bootstrap');
    RAISE EXCEPTION 'VERIFY FAIL: 4001-char body should be rejected';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;

  -- Invalid source rejected
  BEGIN
    INSERT INTO public.wall_entries (body, source_type)
    VALUES ('ok', 'human');
    RAISE EXCEPTION 'VERIFY FAIL: invalid source_type should be rejected';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;

  -- Provenance uniqueness
  INSERT INTO public.wall_entries (body, source_type, source_external_id)
  VALUES ('first', 'x_agent', 'x:probe-1')
  RETURNING id INTO v_dup_id;

  BEGIN
    INSERT INTO public.wall_entries (body, source_type, source_external_id)
    VALUES ('second', 'x_agent', 'x:probe-1');
    RAISE EXCEPTION 'VERIFY FAIL: duplicate provenance should be rejected';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  -- Original body unchanged
  IF (SELECT body FROM public.wall_entries WHERE id = v_dup_id) IS DISTINCT FROM 'first' THEN
    RAISE EXCEPTION 'VERIFY FAIL: original body mutated';
  END IF;

  -- Append-only: UPDATE blocked
  BEGIN
    UPDATE public.wall_entries SET body = 'changed' WHERE id = v_id;
    RAISE EXCEPTION 'VERIFY FAIL: UPDATE should be blocked';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE '%append-only%' THEN
        RAISE;
      END IF;
  END;

  -- Append-only: DELETE blocked
  BEGIN
    DELETE FROM public.wall_entries WHERE id = v_id;
    RAISE EXCEPTION 'VERIFY FAIL: DELETE should be blocked';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE '%append-only%' THEN
        RAISE;
      END IF;
  END;
END
$$;

ROLLBACK;

-- ---------------------------------------------------------------------------
-- H) Summary
-- ---------------------------------------------------------------------------
SELECT
  'H_SUMMARY' AS section,
  (SELECT relrowsecurity FROM pg_class
    WHERE relnamespace = 'public'::regnamespace AND relname = 'wall_entries') AS rls_enabled,
  (SELECT COUNT(*) = 0 FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public'
      AND g.table_name = 'wall_entries'
      AND g.grantee IN ('anon', 'authenticated')
      AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  ) AS no_browser_mutation_grants,
  (SELECT COUNT(*) FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'wall_entries'
      AND policyname = 'wall_entries_public_select') = 1 AS public_select_policy,
  (SELECT COUNT(*) FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'wall_entries_source_provenance_uidx') = 1 AS provenance_unique_index;
