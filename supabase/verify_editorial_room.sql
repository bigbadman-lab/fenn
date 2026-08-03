-- Verify Living Greenwood 6.1 Editorial Room schema (read-only checks)

SELECT to_regclass('public.editorial_runs') AS editorial_runs;
SELECT to_regclass('public.editorial_transmissions') AS editorial_transmissions;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'editorial_runs'
ORDER BY ordinal_position;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'editorial_transmissions'
ORDER BY ordinal_position;
