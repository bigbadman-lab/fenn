-- FENN Stage 2 — Migration 09: Admin audit & settings
-- LOCAL ONLY — do not apply until explicitly authorised.
-- Admin authentication method remains an open product decision.

-- ---------------------------------------------------------------------------
-- admin_audit_log
-- ---------------------------------------------------------------------------
CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id text NOT NULL,
  actor_type text NOT NULL DEFAULT 'admin',
  action text NOT NULL,
  entity_type text,
  entity_id text,
  before_state jsonb,
  after_state jsonb,
  reason text,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT admin_audit_log_actor_id_nonempty
    CHECK (length(trim(actor_id)) > 0),
  CONSTRAINT admin_audit_log_actor_type_check
    CHECK (actor_type IN ('admin', 'system', 'service')),
  CONSTRAINT admin_audit_log_action_nonempty
    CHECK (length(trim(action)) > 0)
);

CREATE INDEX admin_audit_log_created_at_idx
  ON public.admin_audit_log (created_at DESC);

CREATE INDEX admin_audit_log_actor_created_idx
  ON public.admin_audit_log (actor_id, created_at DESC);

CREATE INDEX admin_audit_log_entity_idx
  ON public.admin_audit_log (entity_type, entity_id);

COMMENT ON TABLE public.admin_audit_log IS
  'Privileged action audit trail. actor_id is opaque pending final admin auth.';

-- Append-oriented: block UPDATE/DELETE for normal integrity.
CREATE OR REPLACE FUNCTION public.prevent_admin_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log is append-only';
END;
$$;

CREATE TRIGGER admin_audit_log_prevent_update
  BEFORE UPDATE ON public.admin_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_admin_audit_log_mutation();

CREATE TRIGGER admin_audit_log_prevent_delete
  BEFORE DELETE ON public.admin_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_admin_audit_log_mutation();

-- ---------------------------------------------------------------------------
-- app_settings (architecture only — no seeded open decisions)
-- ---------------------------------------------------------------------------
CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_by_actor_id text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT app_settings_key_nonempty
    CHECK (length(trim(key)) > 0)
);

CREATE TRIGGER app_settings_set_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.app_settings IS
  'Configurable MVP settings (e.g. future greenwood.lifetime_leaf_threshold). No open decisions seeded.';
