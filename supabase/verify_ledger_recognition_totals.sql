-- FENN Ledger recognition totals verification
-- PREREQUISITE: ...30_ledger_recognition_totals.sql

SELECT 'A_RPC' AS section, f.fn, r.rolename,
  CASE
    WHEN has_function_privilege(r.rolename, f.fn, 'EXECUTE') THEN 'HAS_EXECUTE'
    ELSE 'NO_EXECUTE'
  END AS status
FROM (VALUES
  ('public.get_public_leaf_recognition_totals()')
) AS f(fn)
CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolename);
