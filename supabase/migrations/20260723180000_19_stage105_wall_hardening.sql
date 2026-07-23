-- FENN Stage 10.5.4 — The Wall hardening
-- LOCAL ONLY — do not apply until explicitly authorised.
-- Additive. Does not modify prior migrations' table definitions.
--
-- Public readers may see inscription content only.
-- Provenance (source_type, source_external_id) stays service-role / trusted server.

REVOKE SELECT ON TABLE public.wall_entries FROM anon, authenticated;

GRANT SELECT (id, body, created_at)
  ON public.wall_entries
  TO anon, authenticated;

COMMENT ON TABLE public.wall_entries IS
  'FENN Wall inscriptions — append-only. Public SELECT limited to id/body/created_at; provenance is not browser-readable.';
