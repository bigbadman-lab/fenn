-- FENN Living Book verification
-- PREREQUISITE: ...31_chronicle_living_book.sql

SELECT 'A_KIND' AS section,
  conname,
  pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'public.chronicle_entries'::regclass
  AND conname = 'chronicle_entries_kind_check';

SELECT 'B_COVERED_DATE' AS section,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'chronicle_entries'
  AND column_name = 'covered_date';

SELECT 'C_DAILY_UNIQUE' AS section,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'chronicle_entries'
  AND indexname = 'chronicle_entries_daily_covered_date_uidx';

SELECT 'D_PUBLIC_SELECT' AS section,
  polname,
  polcmd,
  pg_get_expr(polqual, polrelid) AS using_expr
FROM pg_policy
WHERE polrelid = 'public.chronicle_entries'::regclass;
