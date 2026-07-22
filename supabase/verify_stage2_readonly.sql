-- =============================================================================
-- FENN Stage 2 — LIVE SCHEMA VERIFICATION (READ-ONLY)
-- Paste into Supabase SQL Editor. Run as a whole or section by section.
--
-- CONTAINS NO: INSERT / UPDATE / DELETE / ALTER / DROP / CREATE / GRANT / REVOKE / TRUNCATE
-- Does not mutate the database.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. EXTENSIONS
-- ---------------------------------------------------------------------------
SELECT
  'A_EXTENSIONS' AS section,
  e.extname AS extension_name,
  n.nspname AS schema_name,
  e.extversion AS version
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname IN ('pgcrypto', 'vector', 'uuid-ossp')
ORDER BY e.extname;

SELECT
  'A_EXTENSIONS_EXPECTATION' AS section,
  expected.extname,
  CASE
    WHEN EXISTS (SELECT 1 FROM pg_extension e WHERE e.extname = expected.extname)
      THEN 'PRESENT'
    ELSE 'MISSING'
  END AS status
FROM (VALUES ('pgcrypto'), ('vector')) AS expected(extname)
ORDER BY expected.extname;

-- ---------------------------------------------------------------------------
-- B. TABLES (expected present / fire_messages absent)
-- ---------------------------------------------------------------------------
WITH expected(table_name, should_exist) AS (
  VALUES
    ('profiles', true),
    ('outlaw_applications', true),
    ('leaf_ledger', true),
    ('camp_characters', true),
    ('camp_sessions', true),
    ('camp_messages', true),
    ('camp_daily_rewards', true),
    ('deeds', true),
    ('deed_submissions', true),
    ('chronicle_entries', true),
    ('fenn_memories', true),
    ('memory_candidates', true),
    ('treasury_config', true),
    ('treasury_assets', true),
    ('treasury_contributions', true),
    ('commons_commitments', true),
    ('commons_allocations', true),
    ('circulations', true),
    ('circulation_recipients', true),
    ('admin_audit_log', true),
    ('app_settings', true),
    ('fire_messages', false)
)
SELECT
  'B_TABLES' AS section,
  e.table_name,
  e.should_exist,
  (to_regclass('public.' || e.table_name) IS NOT NULL) AS actually_exists,
  CASE
    WHEN e.should_exist AND to_regclass('public.' || e.table_name) IS NOT NULL THEN 'OK'
    WHEN (NOT e.should_exist) AND to_regclass('public.' || e.table_name) IS NULL THEN 'OK'
    WHEN e.should_exist AND to_regclass('public.' || e.table_name) IS NULL THEN 'MISSING'
    ELSE 'UNEXPECTED_PRESENT'
  END AS status
FROM expected e
ORDER BY e.should_exist DESC, e.table_name;

-- ---------------------------------------------------------------------------
-- C. COLUMNS (important Stage 2 fields)
-- ---------------------------------------------------------------------------
WITH expected_columns(table_name, column_name) AS (
  VALUES
    -- profiles
    ('profiles', 'id'),
    ('profiles', 'wallet_address'),
    ('profiles', 'outlaw_number'),
    ('profiles', 'alias'),
    ('profiles', 'joined_at'),
    ('profiles', 'privy_user_id'),
    ('profiles', 'leaf_balance'),
    ('profiles', 'leaf_lifetime_earned'),
    ('profiles', 'deeds_completed_count'),
    ('profiles', 'greenwood_entered_at'),
    ('profiles', 'greenwood_threshold_at_entry'),
    ('profiles', 'greenwood_lifetime_leaf_at_entry'),
    ('profiles', 'is_active'),
    ('profiles', 'created_at'),
    ('profiles', 'updated_at'),
    -- leaf_ledger
    ('leaf_ledger', 'id'),
    ('leaf_ledger', 'profile_id'),
    ('leaf_ledger', 'wallet_address'),
    ('leaf_ledger', 'amount'),
    ('leaf_ledger', 'lifetime_delta'),
    ('leaf_ledger', 'source_type'),
    ('leaf_ledger', 'source_id'),
    ('leaf_ledger', 'secondary_source_id'),
    ('leaf_ledger', 'reason'),
    ('leaf_ledger', 'actor_type'),
    ('leaf_ledger', 'actor_id'),
    ('leaf_ledger', 'idempotency_key'),
    ('leaf_ledger', 'metadata'),
    ('leaf_ledger', 'created_at'),
    -- deeds / submissions
    ('deeds', 'is_repeatable'),
    ('deeds', 'access_scope'),
    ('deeds', 'status'),
    ('deeds', 'reward_leaf_fixed'),
    ('deeds', 'reward_leaf_min'),
    ('deeds', 'reward_leaf_max'),
    ('deeds', 'evidence_requirements'),
    ('deeds', 'sponsor_contribution_id'),
    ('deeds', 'common_target_count'),
    ('deed_submissions', 'status'),
    ('deed_submissions', 'evidence_text'),
    ('deed_submissions', 'evidence_url'),
    ('deed_submissions', 'evidence_image_path'),
    ('deed_submissions', 'evidence_other'),
    ('deed_submissions', 'reviewed_by_actor_id'),
    ('deed_submissions', 'leaf_awarded'),
    ('deed_submissions', 'leaf_ledger_id'),
    -- camp
    ('camp_characters', 'slug'),
    ('camp_characters', 'prompt_key'),
    ('camp_characters', 'is_locked'),
    ('camp_characters', 'daily_leaf_cap'),
    ('camp_messages', 'reward_recommendation'),
    ('camp_messages', 'reward_granted'),
    ('camp_messages', 'quality'),
    ('camp_messages', 'originality'),
    ('camp_messages', 'relevance'),
    ('camp_messages', 'spam_probability'),
    ('camp_messages', 'memory_candidate_flag'),
    ('camp_messages', 'leaf_ledger_id'),
    ('camp_messages', 'client_message_hash'),
    ('camp_daily_rewards', 'reward_date'),
    ('camp_daily_rewards', 'character_id'),
    ('camp_daily_rewards', 'leaf_granted'),
    -- treasury / commons
    ('treasury_config', 'treasury_wallet_address'),
    ('treasury_assets', 'symbol'),
    ('treasury_assets', 'chain_id'),
    ('treasury_assets', 'contract_address'),
    ('treasury_assets', 'decimals'),
    ('treasury_assets', 'is_tracked'),
    ('treasury_contributions', 'verified'),
    ('treasury_contributions', 'designation'),
    ('treasury_contributions', 'tx_hash'),
    ('commons_commitments', 'asset_symbol'),
    ('commons_commitments', 'amount'),
    ('commons_allocations', 'delta_amount'),
    ('commons_allocations', 'related_contribution_id'),
    -- circulations
    ('circulations', 'code'),
    ('circulations', 'status'),
    ('circulations', 'basis'),
    ('circulations', 'rules'),
    ('circulations', 'tx_references'),
    ('circulations', 'export_snapshot'),
    ('circulation_recipients', 'wallet_address'),
    ('circulation_recipients', 'amount'),
    ('circulation_recipients', 'paid'),
    ('circulation_recipients', 'tx_hash'),
    -- admin / settings / memory
    ('admin_audit_log', 'actor_id'),
    ('admin_audit_log', 'action'),
    ('admin_audit_log', 'before_state'),
    ('admin_audit_log', 'after_state'),
    ('app_settings', 'key'),
    ('app_settings', 'value'),
    ('fenn_memories', 'layer'),
    ('fenn_memories', 'content'),
    ('memory_candidates', 'status'),
    ('memory_candidates', 'resulting_memory_id'),
    ('chronicle_entries', 'visibility'),
    ('outlaw_applications', 'profile_id'),
    ('outlaw_applications', 'review_status')
)
SELECT
  'C_COLUMNS' AS section,
  ec.table_name,
  ec.column_name,
  CASE
    WHEN c.column_name IS NOT NULL THEN 'OK'
    ELSE 'MISSING'
  END AS status,
  c.data_type,
  c.is_nullable,
  c.column_default
FROM expected_columns ec
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = ec.table_name
 AND c.column_name = ec.column_name
ORDER BY
  CASE WHEN c.column_name IS NULL THEN 0 ELSE 1 END,
  ec.table_name,
  ec.column_name;

-- Columns that must NOT exist (Stage 2 locks)
SELECT
  'C_COLUMNS_FORBIDDEN' AS section,
  t.table_name,
  t.column_name,
  CASE
    WHEN c.column_name IS NULL THEN 'OK_ABSENT'
    ELSE 'UNEXPECTED_PRESENT'
  END AS status
FROM (
  VALUES
    ('profiles', 'standing_mark'),
    ('fenn_memories', 'embedding'),
    ('treasury_config', 'fenn_token_address'),
    ('treasury_config', 'token_contract_address'),
    ('treasury_config', 'launchpad_notes'),
    ('treasury_assets', 'live_balance'),
    ('treasury_assets', 'balance'),
    ('treasury_config', 'balance_usd')
) AS t(table_name, column_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = t.table_name
 AND c.column_name = t.column_name
ORDER BY status DESC, t.table_name, t.column_name;

-- ---------------------------------------------------------------------------
-- D. CONSTRAINTS / INDEXES
-- ---------------------------------------------------------------------------

-- Check constraints (incl. Greenwood snapshot, EVM, idempotency-related uniqueness below)
SELECT
  'D_CHECK_CONSTRAINTS' AS section,
  c.conrelid::regclass::text AS table_name,
  c.conname AS constraint_name,
  pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_class rel ON rel.oid = c.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND c.contype = 'c'
  AND rel.relname = ANY (ARRAY[
    'profiles', 'outlaw_applications', 'leaf_ledger', 'camp_characters',
    'camp_sessions', 'camp_messages', 'camp_daily_rewards', 'deeds',
    'deed_submissions', 'chronicle_entries', 'fenn_memories', 'memory_candidates',
    'treasury_config', 'treasury_assets', 'treasury_contributions',
    'commons_commitments', 'commons_allocations', 'circulations',
    'circulation_recipients', 'admin_audit_log', 'app_settings'
  ])
ORDER BY table_name, constraint_name;

-- Unique constraints (table constraints)
SELECT
  'D_UNIQUE_CONSTRAINTS' AS section,
  c.conrelid::regclass::text AS table_name,
  c.conname AS constraint_name,
  pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_class rel ON rel.oid = c.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND c.contype = 'u'
  AND rel.relname = ANY (ARRAY[
    'profiles', 'outlaw_applications', 'leaf_ledger', 'camp_characters',
    'camp_sessions', 'camp_messages', 'camp_daily_rewards', 'deeds',
    'deed_submissions', 'chronicle_entries', 'fenn_memories', 'memory_candidates',
    'treasury_config', 'treasury_assets', 'treasury_contributions',
    'commons_commitments', 'commons_allocations', 'circulations',
    'circulation_recipients', 'admin_audit_log', 'app_settings'
  ])
ORDER BY table_name, constraint_name;

-- Primary keys
SELECT
  'D_PRIMARY_KEYS' AS section,
  c.conrelid::regclass::text AS table_name,
  c.conname AS constraint_name,
  pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_class rel ON rel.oid = c.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND c.contype = 'p'
  AND rel.relname = ANY (ARRAY[
    'profiles', 'outlaw_applications', 'leaf_ledger', 'camp_characters',
    'camp_sessions', 'camp_messages', 'camp_daily_rewards', 'deeds',
    'deed_submissions', 'chronicle_entries', 'fenn_memories', 'memory_candidates',
    'treasury_config', 'treasury_assets', 'treasury_contributions',
    'commons_commitments', 'commons_allocations', 'circulations',
    'circulation_recipients', 'admin_audit_log', 'app_settings'
  ])
ORDER BY table_name;

-- Foreign keys
SELECT
  'D_FOREIGN_KEYS' AS section,
  c.conrelid::regclass::text AS table_name,
  c.conname AS constraint_name,
  pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_class rel ON rel.oid = c.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND c.contype = 'f'
  AND rel.relname = ANY (ARRAY[
    'profiles', 'outlaw_applications', 'leaf_ledger', 'camp_characters',
    'camp_sessions', 'camp_messages', 'camp_daily_rewards', 'deeds',
    'deed_submissions', 'chronicle_entries', 'fenn_memories', 'memory_candidates',
    'treasury_config', 'treasury_assets', 'treasury_contributions',
    'commons_commitments', 'commons_allocations', 'circulations',
    'circulation_recipients', 'admin_audit_log', 'app_settings'
  ])
ORDER BY table_name, constraint_name;

-- Indexes including partial unique indexes (idempotency, pending submissions, etc.)
SELECT
  'D_INDEXES' AS section,
  tab.relname AS table_name,
  idx.relname AS index_name,
  i.indisunique AS is_unique,
  pg_get_indexdef(i.indexrelid) AS index_definition
FROM pg_index i
JOIN pg_class idx ON idx.oid = i.indexrelid
JOIN pg_class tab ON tab.oid = i.indrelid
JOIN pg_namespace n ON n.oid = tab.relnamespace
WHERE n.nspname = 'public'
  AND tab.relname = ANY (ARRAY[
    'profiles', 'outlaw_applications', 'leaf_ledger', 'camp_characters',
    'camp_sessions', 'camp_messages', 'camp_daily_rewards', 'deeds',
    'deed_submissions', 'chronicle_entries', 'fenn_memories', 'memory_candidates',
    'treasury_config', 'treasury_assets', 'treasury_contributions',
    'commons_commitments', 'commons_allocations', 'circulations',
    'circulation_recipients', 'admin_audit_log', 'app_settings'
  ])
ORDER BY
  CASE WHEN i.indisunique THEN 0 ELSE 1 END,
  tab.relname,
  idx.relname;

-- Spotlight: expected named constraints / indexes
SELECT
  'D_SPOTLIGHT' AS section,
  expected.object_kind,
  expected.object_name,
  CASE
    WHEN expected.object_kind = 'constraint'
      AND EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conname = expected.object_name
      ) THEN 'OK'
    WHEN expected.object_kind = 'index'
      AND EXISTS (
        SELECT 1 FROM pg_class idx
        JOIN pg_namespace n ON n.oid = idx.relnamespace
        WHERE n.nspname = 'public' AND idx.relname = expected.object_name
      ) THEN 'OK'
    WHEN expected.object_kind = 'sequence'
      AND EXISTS (
        SELECT 1 FROM pg_class s
        JOIN pg_namespace n ON n.oid = s.relnamespace
        WHERE n.nspname = 'public'
          AND s.relkind = 'S'
          AND s.relname = expected.object_name
      ) THEN 'OK'
    ELSE 'MISSING'
  END AS status
FROM (
  VALUES
    ('constraint', 'profiles_wallet_address_normalized'),
    ('constraint', 'profiles_greenwood_snapshot_all_or_nothing'),
    ('constraint', 'profiles_leaf_lifetime_earned_nonnegative'),
    ('constraint', 'leaf_ledger_amount_nonzero'),
    ('constraint', 'leaf_ledger_wallet_address_normalized'),
    ('constraint', 'circulation_recipients_wallet_normalized'),
    ('constraint', 'treasury_config_wallet_normalized'),
    ('index', 'profiles_wallet_address_uidx'),
    ('index', 'profiles_outlaw_number_uidx'),
    ('index', 'leaf_ledger_idempotency_key_uidx'),
    ('index', 'deed_submissions_one_pending_per_profile_deed_uidx'),
    ('index', 'camp_daily_rewards_profile_date_character_uidx'),
    ('index', 'outlaw_applications_profile_id_uidx'),
    ('index', 'treasury_config_singleton_uidx'),
    ('sequence', 'outlaw_number_seq')
) AS expected(object_kind, object_name)
ORDER BY status DESC, object_kind, object_name;

-- ---------------------------------------------------------------------------
-- E. FUNCTIONS / TRIGGERS
-- ---------------------------------------------------------------------------
SELECT
  'E_FUNCTIONS' AS section,
  expected.function_signature,
  CASE
    WHEN to_regprocedure(expected.function_signature) IS NOT NULL THEN 'OK'
    ELSE 'MISSING'
  END AS status
FROM (
  VALUES
    ('set_updated_at()'),
    ('is_normalized_evm_address(text)'),
    ('apply_leaf_ledger_to_profile_cache()'),
    ('prevent_leaf_ledger_mutation()'),
    ('enforce_deed_submission_approval_uniqueness()'),
    ('prevent_admin_audit_log_mutation()')
) AS expected(function_signature)
ORDER BY status DESC, function_signature;

-- Function schema locations (public expected)
SELECT
  'E_FUNCTIONS_DETAIL' AS section,
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = ANY (ARRAY[
  'set_updated_at',
  'is_normalized_evm_address',
  'apply_leaf_ledger_to_profile_cache',
  'prevent_leaf_ledger_mutation',
  'enforce_deed_submission_approval_uniqueness',
  'prevent_admin_audit_log_mutation'
])
ORDER BY p.proname, n.nspname;

-- Triggers on Stage 2 tables
SELECT
  'E_TRIGGERS' AS section,
  c.relname AS table_name,
  t.tgname AS trigger_name,
  CASE t.tgtype & 2 WHEN 2 THEN 'BEFORE' ELSE 'AFTER' END AS timing,
  pg_get_triggerdef(t.oid) AS trigger_definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND c.relname = ANY (ARRAY[
    'profiles', 'outlaw_applications', 'leaf_ledger', 'camp_characters',
    'camp_sessions', 'camp_messages', 'camp_daily_rewards', 'deeds',
    'deed_submissions', 'chronicle_entries', 'fenn_memories', 'memory_candidates',
    'treasury_config', 'treasury_assets', 'treasury_contributions',
    'commons_commitments', 'commons_allocations', 'circulations',
    'circulation_recipients', 'admin_audit_log', 'app_settings'
  ])
ORDER BY c.relname, t.tgname;

-- Spotlight expected triggers
SELECT
  'E_TRIGGERS_SPOTLIGHT' AS section,
  expected.table_name,
  expected.trigger_name,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = expected.table_name
        AND t.tgname = expected.trigger_name
        AND NOT t.tgisinternal
    ) THEN 'OK'
    ELSE 'MISSING'
  END AS status
FROM (
  VALUES
    ('profiles', 'profiles_set_updated_at'),
    ('leaf_ledger', 'leaf_ledger_apply_profile_cache'),
    ('leaf_ledger', 'leaf_ledger_prevent_update'),
    ('leaf_ledger', 'leaf_ledger_prevent_delete'),
    ('deed_submissions', 'deed_submissions_enforce_approval_uniqueness'),
    ('deed_submissions', 'deed_submissions_set_updated_at'),
    ('admin_audit_log', 'admin_audit_log_prevent_update'),
    ('admin_audit_log', 'admin_audit_log_prevent_delete'),
    ('outlaw_applications', 'outlaw_applications_set_updated_at'),
    ('deeds', 'deeds_set_updated_at'),
    ('camp_sessions', 'camp_sessions_set_updated_at'),
    ('app_settings', 'app_settings_set_updated_at')
) AS expected(table_name, trigger_name)
ORDER BY status DESC, table_name, trigger_name;

-- ---------------------------------------------------------------------------
-- F. RLS (enabled + policies)
-- ---------------------------------------------------------------------------
SELECT
  'F_RLS_ENABLED' AS section,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  CASE WHEN c.relrowsecurity THEN 'OK' ELSE 'RLS_DISABLED' END AS status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname = ANY (ARRAY[
    'profiles', 'outlaw_applications', 'leaf_ledger', 'camp_characters',
    'camp_sessions', 'camp_messages', 'camp_daily_rewards', 'deeds',
    'deed_submissions', 'chronicle_entries', 'fenn_memories', 'memory_candidates',
    'treasury_config', 'treasury_assets', 'treasury_contributions',
    'commons_commitments', 'commons_allocations', 'circulations',
    'circulation_recipients', 'admin_audit_log', 'app_settings'
  ])
ORDER BY status DESC, c.relname;

SELECT
  'F_RLS_POLICIES' AS section,
  schemaname,
  tablename,
  policyname,
  permissive,
  roles::text AS roles,
  cmd AS command,
  qual AS using_expression,
  with_check AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = ANY (ARRAY[
    'profiles', 'outlaw_applications', 'leaf_ledger', 'camp_characters',
    'camp_sessions', 'camp_messages', 'camp_daily_rewards', 'deeds',
    'deed_submissions', 'chronicle_entries', 'fenn_memories', 'memory_candidates',
    'treasury_config', 'treasury_assets', 'treasury_contributions',
    'commons_commitments', 'commons_allocations', 'circulations',
    'circulation_recipients', 'admin_audit_log', 'app_settings'
  ])
ORDER BY tablename, policyname;

-- Sensitive tables should have ZERO policies (deny-by-default under RLS)
SELECT
  'F_RLS_SENSITIVE_NO_POLICY' AS section,
  t.table_name,
  COALESCE(p.policy_count, 0) AS policy_count,
  CASE
    WHEN COALESCE(p.policy_count, 0) = 0 THEN 'OK_NO_PUBLIC_POLICY'
    ELSE 'UNEXPECTED_POLICIES'
  END AS status
FROM (
  VALUES
    ('profiles'),
    ('outlaw_applications'),
    ('leaf_ledger'),
    ('deed_submissions'),
    ('camp_sessions'),
    ('camp_messages'),
    ('camp_daily_rewards'),
    ('memory_candidates'),
    ('fenn_memories'),
    ('circulation_recipients'),
    ('admin_audit_log'),
    ('app_settings')
) AS t(table_name)
LEFT JOIN (
  SELECT tablename, COUNT(*)::int AS policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
  GROUP BY tablename
) p ON p.tablename = t.table_name
ORDER BY status DESC, t.table_name;

-- Expected public SELECT policies present
SELECT
  'F_RLS_EXPECTED_PUBLIC_POLICIES' AS section,
  expected.policyname,
  expected.tablename,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = expected.tablename
        AND p.policyname = expected.policyname
        AND p.cmd = 'SELECT'
    ) THEN 'OK'
    ELSE 'MISSING'
  END AS status
FROM (
  VALUES
    ('deeds_public_select', 'deeds'),
    ('chronicle_entries_public_select', 'chronicle_entries'),
    ('camp_characters_public_select', 'camp_characters'),
    ('treasury_assets_public_select', 'treasury_assets'),
    ('treasury_config_public_select', 'treasury_config'),
    ('treasury_contributions_public_select', 'treasury_contributions'),
    ('commons_commitments_public_select', 'commons_commitments'),
    ('commons_allocations_public_select', 'commons_allocations'),
    ('circulations_public_select', 'circulations')
) AS expected(policyname, tablename)
ORDER BY status DESC, tablename;

-- ---------------------------------------------------------------------------
-- G. GRANTS (anon / authenticated) — focus on mutation risk
-- ---------------------------------------------------------------------------
SELECT
  'G_GRANTS_SENSITIVE' AS section,
  g.table_name,
  g.grantee,
  g.privilege_type,
  CASE
    WHEN g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES')
      THEN 'UNEXPECTED_MUTATION_OR_EXTRA'
    WHEN g.privilege_type = 'SELECT'
      THEN 'SELECT_GRANTED_RLS_MUST_DENY'
    ELSE 'OTHER'
  END AS assessment
FROM information_schema.role_table_grants g
WHERE g.table_schema = 'public'
  AND g.grantee IN ('anon', 'authenticated')
  AND g.table_name = ANY (ARRAY[
    'profiles',
    'outlaw_applications',
    'leaf_ledger',
    'deed_submissions',
    'camp_sessions',
    'camp_messages',
    'camp_daily_rewards',
    'memory_candidates',
    'fenn_memories',
    'circulation_recipients',
    'admin_audit_log',
    'app_settings'
  ])
ORDER BY
  CASE
    WHEN g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE') THEN 0
    ELSE 1
  END,
  g.table_name,
  g.grantee,
  g.privilege_type;

-- Compact mutation permission check (should be empty / no rows for INSERT/UPDATE/DELETE)
SELECT
  'G_GRANTS_MUTATION_VIOLATIONS' AS section,
  g.table_name,
  g.grantee,
  g.privilege_type,
  'FAIL_HAS_MUTATION_GRANT' AS status
FROM information_schema.role_table_grants g
WHERE g.table_schema = 'public'
  AND g.grantee IN ('anon', 'authenticated')
  AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  AND g.table_name = ANY (ARRAY[
    'profiles', 'outlaw_applications', 'leaf_ledger', 'camp_characters',
    'camp_sessions', 'camp_messages', 'camp_daily_rewards', 'deeds',
    'deed_submissions', 'chronicle_entries', 'fenn_memories', 'memory_candidates',
    'treasury_config', 'treasury_assets', 'treasury_contributions',
    'commons_commitments', 'commons_allocations', 'circulations',
    'circulation_recipients', 'admin_audit_log', 'app_settings'
  ])
ORDER BY g.table_name, g.grantee, g.privilege_type;

-- ---------------------------------------------------------------------------
-- H. CAMP SEED (identity only)
-- ---------------------------------------------------------------------------
SELECT
  'H_CAMP_SEED' AS section,
  slug,
  display_name,
  role_title,
  prompt_key,
  is_active,
  is_locked,
  daily_leaf_cap,
  sort_order
FROM public.camp_characters
ORDER BY sort_order, slug;

SELECT
  'H_CAMP_SEED_CHECK' AS section,
  (SELECT COUNT(*) FROM public.camp_characters) AS total_characters,
  (SELECT COUNT(*) FROM public.camp_characters WHERE slug IN ('fenn', 'wren', 'rook')) AS expected_three_present,
  CASE
    WHEN (SELECT COUNT(*) FROM public.camp_characters) = 3
     AND (SELECT COUNT(*) FROM public.camp_characters WHERE slug = 'fenn') = 1
     AND (SELECT COUNT(*) FROM public.camp_characters WHERE slug = 'wren') = 1
     AND (SELECT COUNT(*) FROM public.camp_characters WHERE slug = 'rook') = 1
    THEN 'OK'
    ELSE 'UNEXPECTED_SEED'
  END AS status;

-- ---------------------------------------------------------------------------
-- I. SETTINGS / ECONOMIC DATA EMPTINESS
-- ---------------------------------------------------------------------------
SELECT
  'I_APP_SETTINGS' AS section,
  COUNT(*)::int AS settings_row_count,
  COUNT(*) FILTER (
    WHERE key ILIKE '%greenwood%threshold%'
       OR key ILIKE '%lifetime_leaf_threshold%'
  )::int AS greenwood_threshold_keys,
  CASE
    WHEN COUNT(*) = 0 THEN 'OK_EMPTY'
    ELSE 'HAS_ROWS_REVIEW'
  END AS status
FROM public.app_settings;

SELECT
  'I_TREASURY_CONFIG' AS section,
  COUNT(*)::int AS treasury_config_rows,
  CASE WHEN COUNT(*) = 0 THEN 'OK_EMPTY' ELSE 'HAS_ROWS_REVIEW' END AS status
FROM public.treasury_config;

SELECT
  'I_TREASURY_ASSETS' AS section,
  COUNT(*)::int AS treasury_asset_rows,
  CASE WHEN COUNT(*) = 0 THEN 'OK_EMPTY' ELSE 'HAS_ROWS_REVIEW' END AS status
FROM public.treasury_assets;

SELECT
  'I_TREASURY_CONTRIBUTIONS' AS section,
  COUNT(*)::int AS contribution_rows,
  CASE WHEN COUNT(*) = 0 THEN 'OK_EMPTY' ELSE 'HAS_ROWS_REVIEW' END AS status
FROM public.treasury_contributions;

SELECT
  'I_COMMONS' AS section,
  (SELECT COUNT(*)::int FROM public.commons_commitments) AS commitment_rows,
  (SELECT COUNT(*)::int FROM public.commons_allocations) AS allocation_rows,
  CASE
    WHEN (SELECT COUNT(*) FROM public.commons_commitments) = 0
     AND (SELECT COUNT(*) FROM public.commons_allocations) = 0
    THEN 'OK_EMPTY'
    ELSE 'HAS_ROWS_REVIEW'
  END AS status;

SELECT
  'I_CIRCULATIONS' AS section,
  (SELECT COUNT(*)::int FROM public.circulations) AS circulation_rows,
  (SELECT COUNT(*)::int FROM public.circulation_recipients) AS recipient_rows,
  CASE
    WHEN (SELECT COUNT(*) FROM public.circulations) = 0
     AND (SELECT COUNT(*) FROM public.circulation_recipients) = 0
    THEN 'OK_EMPTY'
    ELSE 'HAS_ROWS_REVIEW'
  END AS status;

SELECT
  'I_NO_FENN_TOKEN_COLUMNS' AS section,
  COUNT(*)::int AS forbidden_column_hits,
  CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'UNEXPECTED_TOKEN_COLUMNS' END AS status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    column_name ILIKE '%fenn_token%'
    OR column_name ILIKE '%token_contract%'
    OR column_name ILIKE '%launchpad%'
  );

-- ---------------------------------------------------------------------------
-- J. SUMMARY — single pass/fail style checklist
-- ---------------------------------------------------------------------------
WITH checks AS (
  SELECT 'extensions_pgcrypto' AS check_name,
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') AS ok
  UNION ALL
  SELECT 'extensions_vector',
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
  UNION ALL
  SELECT 'no_fire_messages',
    to_regclass('public.fire_messages') IS NULL
  UNION ALL
  SELECT 'all_21_tables_present',
    (
      SELECT COUNT(*) FILTER (WHERE to_regclass('public.' || t) IS NOT NULL)
      FROM unnest(ARRAY[
        'profiles','outlaw_applications','leaf_ledger','camp_characters','camp_sessions',
        'camp_messages','camp_daily_rewards','deeds','deed_submissions','chronicle_entries',
        'fenn_memories','memory_candidates','treasury_config','treasury_assets',
        'treasury_contributions','commons_commitments','commons_allocations','circulations',
        'circulation_recipients','admin_audit_log','app_settings'
      ]) AS t
    ) = 21
  UNION ALL
  SELECT 'fn_set_updated_at',
    to_regprocedure('set_updated_at()') IS NOT NULL
  UNION ALL
  SELECT 'fn_is_normalized_evm_address',
    to_regprocedure('is_normalized_evm_address(text)') IS NOT NULL
  UNION ALL
  SELECT 'fn_apply_leaf_ledger_to_profile_cache',
    to_regprocedure('apply_leaf_ledger_to_profile_cache()') IS NOT NULL
  UNION ALL
  SELECT 'fn_prevent_leaf_ledger_mutation',
    to_regprocedure('prevent_leaf_ledger_mutation()') IS NOT NULL
  UNION ALL
  SELECT 'fn_enforce_deed_submission_approval_uniqueness',
    to_regprocedure('enforce_deed_submission_approval_uniqueness()') IS NOT NULL
  UNION ALL
  SELECT 'fn_prevent_admin_audit_log_mutation',
    to_regprocedure('prevent_admin_audit_log_mutation()') IS NOT NULL
  UNION ALL
  SELECT 'trg_leaf_ledger_cache',
    EXISTS (
      SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'leaf_ledger'
        AND t.tgname = 'leaf_ledger_apply_profile_cache' AND NOT t.tgisinternal
    )
  UNION ALL
  SELECT 'trg_leaf_ledger_immutable',
    (
      SELECT COUNT(*) FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'leaf_ledger'
        AND t.tgname IN ('leaf_ledger_prevent_update', 'leaf_ledger_prevent_delete')
        AND NOT t.tgisinternal
    ) = 2
  UNION ALL
  SELECT 'rls_enabled_all_21',
    (
      SELECT COUNT(*) FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
        AND c.relname = ANY (ARRAY[
          'profiles','outlaw_applications','leaf_ledger','camp_characters','camp_sessions',
          'camp_messages','camp_daily_rewards','deeds','deed_submissions','chronicle_entries',
          'fenn_memories','memory_candidates','treasury_config','treasury_assets',
          'treasury_contributions','commons_commitments','commons_allocations','circulations',
          'circulation_recipients','admin_audit_log','app_settings'
        ])
    ) = 21
  UNION ALL
  SELECT 'no_mutation_grants_anon_auth',
    NOT EXISTS (
      SELECT 1 FROM information_schema.role_table_grants g
      WHERE g.table_schema = 'public'
        AND g.grantee IN ('anon', 'authenticated')
        AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
        AND g.table_name = ANY (ARRAY[
          'profiles','outlaw_applications','leaf_ledger','camp_characters','camp_sessions',
          'camp_messages','camp_daily_rewards','deeds','deed_submissions','chronicle_entries',
          'fenn_memories','memory_candidates','treasury_config','treasury_assets',
          'treasury_contributions','commons_commitments','commons_allocations','circulations',
          'circulation_recipients','admin_audit_log','app_settings'
        ])
    )
  UNION ALL
  SELECT 'camp_seed_exactly_fenn_wren_rook',
    (SELECT COUNT(*) FROM public.camp_characters) = 3
    AND (SELECT COUNT(*) FROM public.camp_characters WHERE slug IN ('fenn','wren','rook')) = 3
  UNION ALL
  SELECT 'no_app_settings_seeded',
    (SELECT COUNT(*) FROM public.app_settings) = 0
  UNION ALL
  SELECT 'no_treasury_config_seeded',
    (SELECT COUNT(*) FROM public.treasury_config) = 0
  UNION ALL
  SELECT 'no_commons_seeded',
    (SELECT COUNT(*) FROM public.commons_commitments) = 0
    AND (SELECT COUNT(*) FROM public.commons_allocations) = 0
  UNION ALL
  SELECT 'no_circulations_seeded',
    (SELECT COUNT(*) FROM public.circulations) = 0
    AND (SELECT COUNT(*) FROM public.circulation_recipients) = 0
  UNION ALL
  SELECT 'profiles_has_greenwood_snapshot_constraint',
    EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'profiles_greenwood_snapshot_all_or_nothing'
    )
  UNION ALL
  SELECT 'leaf_idempotency_index',
    EXISTS (
      SELECT 1 FROM pg_class idx
      JOIN pg_namespace n ON n.oid = idx.relnamespace
      WHERE n.nspname = 'public' AND idx.relname = 'leaf_ledger_idempotency_key_uidx'
    )
  UNION ALL
  SELECT 'no_standing_mark_column',
    NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'standing_mark'
    )
  UNION ALL
  SELECT 'no_embedding_column',
    NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'fenn_memories' AND column_name = 'embedding'
    )
)
SELECT
  'J_SUMMARY' AS section,
  check_name,
  CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result
FROM checks
ORDER BY result DESC, check_name;

SELECT
  'J_SUMMARY_ROLLUP' AS section,
  COUNT(*) FILTER (WHERE NOT ok)::int AS fail_count,
  COUNT(*) FILTER (WHERE ok)::int AS pass_count,
  COUNT(*)::int AS total_checks,
  CASE
    WHEN COUNT(*) FILTER (WHERE NOT ok) = 0 THEN 'STAGE_2_APPEARS_CORRECT'
    ELSE 'STAGE_2_HAS_FAILURES_REVIEW_J_SUMMARY'
  END AS overall
FROM (
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') AS ok
  UNION ALL SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
  UNION ALL SELECT to_regclass('public.fire_messages') IS NULL
  UNION ALL SELECT (
      SELECT COUNT(*) FILTER (WHERE to_regclass('public.' || t) IS NOT NULL)
      FROM unnest(ARRAY[
        'profiles','outlaw_applications','leaf_ledger','camp_characters','camp_sessions',
        'camp_messages','camp_daily_rewards','deeds','deed_submissions','chronicle_entries',
        'fenn_memories','memory_candidates','treasury_config','treasury_assets',
        'treasury_contributions','commons_commitments','commons_allocations','circulations',
        'circulation_recipients','admin_audit_log','app_settings'
      ]) AS t
    ) = 21
  UNION ALL SELECT to_regprocedure('set_updated_at()') IS NOT NULL
  UNION ALL SELECT to_regprocedure('is_normalized_evm_address(text)') IS NOT NULL
  UNION ALL SELECT to_regprocedure('apply_leaf_ledger_to_profile_cache()') IS NOT NULL
  UNION ALL SELECT to_regprocedure('prevent_leaf_ledger_mutation()') IS NOT NULL
  UNION ALL SELECT to_regprocedure('enforce_deed_submission_approval_uniqueness()') IS NOT NULL
  UNION ALL SELECT to_regprocedure('prevent_admin_audit_log_mutation()') IS NOT NULL
  UNION ALL SELECT NOT EXISTS (
      SELECT 1 FROM information_schema.role_table_grants g
      WHERE g.table_schema = 'public'
        AND g.grantee IN ('anon', 'authenticated')
        AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
        AND g.table_name = ANY (ARRAY[
          'profiles','outlaw_applications','leaf_ledger','camp_characters','camp_sessions',
          'camp_messages','camp_daily_rewards','deeds','deed_submissions','chronicle_entries',
          'fenn_memories','memory_candidates','treasury_config','treasury_assets',
          'treasury_contributions','commons_commitments','commons_allocations','circulations',
          'circulation_recipients','admin_audit_log','app_settings'
        ])
    )
  UNION ALL SELECT (SELECT COUNT(*) FROM public.camp_characters WHERE slug IN ('fenn','wren','rook')) = 3
             AND (SELECT COUNT(*) FROM public.camp_characters) = 3
  UNION ALL SELECT (SELECT COUNT(*) FROM public.app_settings) = 0
  UNION ALL SELECT (SELECT COUNT(*) FROM public.treasury_config) = 0
  UNION ALL SELECT (SELECT COUNT(*) FROM public.commons_commitments) = 0
  UNION ALL SELECT (SELECT COUNT(*) FROM public.circulations) = 0
) s;

-- Optional note: SQL Editor applies often have no CLI migration history table.
-- Do not reference supabase_migrations.schema_migrations directly (parse-time error if absent).
SELECT
  'J_MIGRATION_HISTORY_NOTE' AS section,
  (to_regclass('supabase_migrations.schema_migrations') IS NOT NULL) AS schema_migrations_table_exists,
  'If false: expected after manual SQL Editor applies. Schema can still be correct.' AS note;
