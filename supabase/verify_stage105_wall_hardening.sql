-- FENN Stage 10.5.4 — Verification for Wall hardening (provenance columns)
--
-- PREREQUISITE: apply
--   supabase/migrations/20260723160000_17_stage105_wall_entries.sql
--   supabase/migrations/20260723170000_18_stage105_wall_marks.sql
--   supabase/migrations/20260723180000_19_stage105_wall_hardening.sql
--
-- Also run:
--   supabase/verify_stage105_wall_entries.sql
--   supabase/verify_stage105_wall_marks.sql

-- ---------------------------------------------------------------------------
-- A) Browser roles: public columns allowed
-- ---------------------------------------------------------------------------
SELECT
  'A_PUBLIC_COLUMNS' AS section,
  r.rolname,
  c.column_name,
  CASE
    WHEN has_column_privilege(r.rolname, 'public.wall_entries', c.column_name, 'SELECT')
      THEN 'OK_GRANTED'
    ELSE 'MISSING_GRANT'
  END AS status
FROM (
  VALUES ('anon'), ('authenticated')
) AS r(rolname)
CROSS JOIN (
  VALUES ('id'), ('body'), ('created_at')
) AS c(column_name)
ORDER BY r.rolname, c.column_name;

-- ---------------------------------------------------------------------------
-- B) Browser roles: provenance columns blocked
-- ---------------------------------------------------------------------------
SELECT
  'B_PROVENANCE_BLOCKED' AS section,
  r.rolname,
  c.column_name,
  CASE
    WHEN has_column_privilege(r.rolname, 'public.wall_entries', c.column_name, 'SELECT')
      THEN 'UNEXPECTED_GRANT'
    ELSE 'OK_REVOKED'
  END AS status
FROM (
  VALUES ('anon'), ('authenticated')
) AS r(rolname)
CROSS JOIN (
  VALUES ('source_type'), ('source_external_id')
) AS c(column_name)
ORDER BY r.rolname, c.column_name;

-- ---------------------------------------------------------------------------
-- C) Browser mutation still blocked on wall_entries
-- ---------------------------------------------------------------------------
SELECT
  'C_MUTATION_BLOCKED' AS section,
  r.rolname,
  p.privilege_type,
  CASE
    WHEN has_table_privilege(r.rolname, 'public.wall_entries', p.privilege_type)
      THEN 'UNEXPECTED_GRANT'
    ELSE 'OK_REVOKED'
  END AS status
FROM (
  VALUES ('anon'), ('authenticated')
) AS r(rolname)
CROSS JOIN (
  VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')
) AS p(privilege_type)
ORDER BY r.rolname, p.privilege_type;
