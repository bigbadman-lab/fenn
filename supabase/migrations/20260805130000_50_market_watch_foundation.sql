-- FENN Market Watch 1.0A — official pool observation foundation
-- Local-only until authorised for production application.
-- No invented official token/pool addresses. Config starts disabled.
-- Service-role only. No public reads/writes in this stage.

-- ---------------------------------------------------------------------------
-- A. Official source configuration (singleton)
-- ---------------------------------------------------------------------------
CREATE TABLE public.market_watch_config (
  id smallint PRIMARY KEY DEFAULT 1
    CHECK (id = 1),
  chain_id integer NOT NULL DEFAULT 4663
    CHECK (chain_id = 4663),
  token_address text
    CHECK (
      token_address IS NULL
      OR token_address ~ '^0x[a-f0-9]{40}$'
    ),
  token_decimals integer
    CHECK (
      token_decimals IS NULL
      OR (token_decimals >= 0 AND token_decimals <= 255)
    ),
  token_symbol text,
  pool_address text
    CHECK (
      pool_address IS NULL
      OR pool_address ~ '^0x[a-f0-9]{40}$'
    ),
  pool_kind text
    CHECK (
      pool_kind IS NULL
      OR pool_kind IN ('uniswap_v2', 'uniswap_v3', 'custom')
    ),
  quote_token_address text
    CHECK (
      quote_token_address IS NULL
      OR quote_token_address ~ '^0x[a-f0-9]{40}$'
    ),
  quote_token_decimals integer
    CHECK (
      quote_token_decimals IS NULL
      OR (quote_token_decimals >= 0 AND quote_token_decimals <= 255)
    ),
  quote_token_symbol text,
  launch_block bigint
    CHECK (launch_block IS NULL OR launch_block >= 0),
  confirmation_depth integer NOT NULL DEFAULT 5
    CHECK (confirmation_depth >= 1 AND confirmation_depth <= 64),
  min_display_fenn_raw numeric NOT NULL DEFAULT 0
    CHECK (min_display_fenn_raw >= 0),
  classification_version text NOT NULL DEFAULT 'mw_v1',
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

COMMENT ON TABLE public.market_watch_config IS
  'Singleton official Market Watch source. Disabled until ops fills real pool/token.';

ALTER TABLE public.market_watch_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.market_watch_config FROM PUBLIC;
REVOKE ALL ON TABLE public.market_watch_config FROM anon, authenticated;
GRANT ALL ON TABLE public.market_watch_config TO service_role;

INSERT INTO public.market_watch_config (id, chain_id, enabled, confirmation_depth, min_display_fenn_raw, classification_version)
VALUES (1, 4663, false, 5, 0, 'mw_v1')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- B. Classified market events
-- ---------------------------------------------------------------------------
CREATE TABLE public.market_watch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id integer NOT NULL
    CHECK (chain_id = 4663),
  event_type text NOT NULL
    CHECK (event_type IN ('acquisition', 'disposal')),
  token_address text NOT NULL
    CHECK (token_address ~ '^0x[a-f0-9]{40}$'),
  pool_address text NOT NULL
    CHECK (pool_address ~ '^0x[a-f0-9]{40}$'),
  quote_token_address text NOT NULL
    CHECK (quote_token_address ~ '^0x[a-f0-9]{40}$'),
  transaction_hash text NOT NULL
    CHECK (transaction_hash ~ '^0x[a-f0-9]{64}$'),
  log_index integer NOT NULL
    CHECK (log_index >= 0),
  block_number bigint NOT NULL
    CHECK (block_number >= 0),
  block_hash text
    CHECK (block_hash IS NULL OR block_hash ~ '^0x[a-f0-9]{64}$'),
  block_timestamp timestamptz,
  fenn_amount_raw numeric NOT NULL
    CHECK (fenn_amount_raw >= 0),
  quote_amount_raw numeric NOT NULL
    CHECK (quote_amount_raw >= 0),
  tx_from text
    CHECK (tx_from IS NULL OR tx_from ~ '^0x[a-f0-9]{40}$'),
  classification_version text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('observed', 'published', 'suppressed', 'reorged')),
  suppress_reason text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  reorged_at timestamptz,
  raw_log jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_watch_events_unique_log
    UNIQUE (chain_id, transaction_hash, log_index),
  CONSTRAINT market_watch_events_published_requires_ts
    CHECK (
      (status <> 'published')
      OR (published_at IS NOT NULL)
    ),
  CONSTRAINT market_watch_events_suppressed_has_reason
    CHECK (
      (status <> 'suppressed')
      OR (suppress_reason IS NOT NULL AND length(trim(suppress_reason)) > 0)
    )
);

COMMENT ON TABLE public.market_watch_events IS
  'Authoritative classified pool Swap facts. Deduped by chain+tx+log_index.';

CREATE INDEX market_watch_events_status_observed_idx
  ON public.market_watch_events (status, observed_at DESC);

CREATE INDEX market_watch_events_block_number_idx
  ON public.market_watch_events (chain_id, block_number DESC);

CREATE INDEX market_watch_events_published_at_idx
  ON public.market_watch_events (published_at DESC NULLS LAST)
  WHERE status = 'published';

ALTER TABLE public.market_watch_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.market_watch_events FROM PUBLIC;
REVOKE ALL ON TABLE public.market_watch_events FROM anon, authenticated;
GRANT ALL ON TABLE public.market_watch_events TO service_role;

-- ---------------------------------------------------------------------------
-- C. Durable block cursor (one per source)
-- ---------------------------------------------------------------------------
CREATE TABLE public.market_watch_cursors (
  source_key text PRIMARY KEY
    CHECK (length(trim(source_key)) > 0 AND length(source_key) <= 128),
  chain_id integer NOT NULL
    CHECK (chain_id = 4663),
  pool_address text NOT NULL
    CHECK (pool_address ~ '^0x[a-f0-9]{40}$'),
  last_safe_block bigint NOT NULL
    CHECK (last_safe_block >= 0),
  last_safe_block_hash text
    CHECK (
      last_safe_block_hash IS NULL
      OR last_safe_block_hash ~ '^0x[a-f0-9]{64}$'
    ),
  classification_version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.market_watch_cursors IS
  'Durable confirmed block cursor for Market Watch official pool sources.';

ALTER TABLE public.market_watch_cursors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.market_watch_cursors FROM PUBLIC;
REVOKE ALL ON TABLE public.market_watch_cursors FROM anon, authenticated;
GRANT ALL ON TABLE public.market_watch_cursors TO service_role;

-- ---------------------------------------------------------------------------
-- D. Worker health / runtime state (singleton)
-- ---------------------------------------------------------------------------
CREATE TABLE public.market_watch_worker_state (
  id smallint PRIMARY KEY DEFAULT 1
    CHECK (id = 1),
  mode text NOT NULL DEFAULT 'disabled'
    CHECK (mode IN ('disabled', 'dry_run', 'live')),
  configured boolean NOT NULL DEFAULT false,
  last_tick_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  latest_chain_block bigint,
  last_processed_block bigint,
  cursor_lag_blocks bigint,
  events_seen bigint NOT NULL DEFAULT 0,
  acquisitions_classified bigint NOT NULL DEFAULT 0,
  disposals_classified bigint NOT NULL DEFAULT 0,
  suppressed_count bigint NOT NULL DEFAULT 0,
  worker_version text,
  lease_holder text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.market_watch_worker_state IS
  'Market Watch worker heartbeat. No secrets or RPC URLs.';

ALTER TABLE public.market_watch_worker_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.market_watch_worker_state FROM PUBLIC;
REVOKE ALL ON TABLE public.market_watch_worker_state FROM anon, authenticated;
GRANT ALL ON TABLE public.market_watch_worker_state TO service_role;

INSERT INTO public.market_watch_worker_state (id, mode, configured, worker_version)
VALUES (1, 'disabled', false, '1.0a')
ON CONFLICT (id) DO NOTHING;
