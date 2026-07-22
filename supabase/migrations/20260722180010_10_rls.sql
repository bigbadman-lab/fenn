-- FENN Stage 2 — Migration 10: RLS & privilege posture
-- LOCAL ONLY — do not apply until explicitly authorised.
--
-- Identity is Privy + trusted Next.js server + service-role.
-- Supabase auth.uid() is NOT the MVP identity mechanism.
-- Therefore Stage 2 RLS is deliberately conservative:
--   - anon/authenticated: SELECT only on explicitly safe public surfaces
--   - no anon/authenticated writes on economic/identity tables
--   - owner reads/writes go through server service-role after Privy verification

-- ---------------------------------------------------------------------------
-- Enable RLS on all application tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outlaw_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaf_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.camp_characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.camp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.camp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.camp_daily_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deed_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chronicle_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fenn_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commons_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commons_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circulation_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Revoke broad write privileges from browser-facing roles.
-- service_role bypasses RLS and remains server-only in application code.
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- Keep SELECT grant so RLS policies can allow specific reads.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public SELECT policies (safe surfaces only)
-- No policies on sensitive tables => deny by default under RLS.
-- ---------------------------------------------------------------------------

-- Active public Deeds (row-level; Stage 5/6 may still prefer server projections).
CREATE POLICY deeds_public_select
  ON public.deeds
  FOR SELECT
  TO anon, authenticated
  USING (status = 'active' AND is_public = true);

-- Public Chronicle / Notice Tree entries.
CREATE POLICY chronicle_entries_public_select
  ON public.chronicle_entries
  FOR SELECT
  TO anon, authenticated
  USING (visibility = 'public');

-- Active Camp character identity (no secret prompts stored).
CREATE POLICY camp_characters_public_select
  ON public.camp_characters
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

-- Tracked Treasury asset metadata (not live balances).
CREATE POLICY treasury_assets_public_select
  ON public.treasury_assets
  FOR SELECT
  TO anon, authenticated
  USING (is_tracked = true);

-- Public Treasury wallet configuration (address is public by product design).
CREATE POLICY treasury_config_public_select
  ON public.treasury_config
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Verified contribution annotations only.
CREATE POLICY treasury_contributions_public_select
  ON public.treasury_contributions
  FOR SELECT
  TO anon, authenticated
  USING (verified = true);

-- Current Commons commitments (explicitly designated value only).
CREATE POLICY commons_commitments_public_select
  ON public.commons_commitments
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Optional transparency into Commons commitment change history.
CREATE POLICY commons_allocations_public_select
  ON public.commons_allocations
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Completed Circulations for The Ledger.
CREATE POLICY circulations_public_select
  ON public.circulations
  FOR SELECT
  TO anon, authenticated
  USING (status = 'completed');

-- ---------------------------------------------------------------------------
-- Explicitly NO public policies on:
--   profiles, outlaw_applications, leaf_ledger,
--   camp_sessions, camp_messages, camp_daily_rewards,
--   deed_submissions, memory_candidates, fenn_memories,
--   circulation_recipients, admin_audit_log, app_settings
-- Owner access is via trusted server + service-role after Privy verification.
-- ---------------------------------------------------------------------------

COMMENT ON POLICY deeds_public_select ON public.deeds IS
  'Anonymous/public read of active public Deeds only.';
COMMENT ON POLICY chronicle_entries_public_select ON public.chronicle_entries IS
  'Anonymous/public read of public Chronicle/notice entries.';
COMMENT ON POLICY circulations_public_select ON public.circulations IS
  'Anonymous/public read of completed Circulations for The Ledger.';
