-- Stage 11.5 example: private scoped search (service_role / SQL editor)
-- Not for browser roles.

-- Example zero query vector (replace with a real embedding in ops tooling):
-- SELECT * FROM public.search_fenn_memory_chunks(
--   (SELECT embedding FROM public.fenn_memory_chunks LIMIT 1),
--   'public_agent',
--   5
-- );
