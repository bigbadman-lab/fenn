/**
 * Market Watch 1.0A — official pool Swap observation worker.
 *
 * Separated from the X-agent cron. Long-running Render background worker.
 * Website and Desk health remain on Vercel. Supabase is the system of record.
 */

# Architecture

```text
Vercel                              Render worker (always-on)
├── Website                         └── npm run market-watch:worker
├── Desk API health only                    │
└── (no public MW feed yet)                 ▼
                                     FENN_MARKET_WATCH_MODE
                                     disabled | dry_run | live
                                            │
                                            ▼
                                     ops_runtime_leases
                                     lease_key = market_watch
                                            │
                                            ▼
                                     HTTP RPC poll (≈10s)
                                     official pool Swap logs
                                            │
                                            ▼
                                     classify → persist → cursor
                                     market_watch_* tables
```

| Owner    | Responsibility |
|----------|----------------|
| Vercel   | Website, Desk health route `/api/desk/market-watch` |
| Render   | Always-on worker process |
| Supabase | Config, events, cursors, worker state, leases |

# Service type

`npm run market-watch:worker` is a **long-running** process (unlike `agent:run-x`).

Render service: **Background Worker** `fenn-market-watch` in [`render.yaml`](../render.yaml).

Default `FENN_MARKET_WATCH_MODE=disabled`.

# Required env

| Variable | Class | Notes |
|----------|-------|-------|
| `FENN_MARKET_WATCH_MODE` | optional / Render-first | `disabled` \| `dry_run` \| `live`; default disabled |
| `FENN_MARKET_WATCH_POLL_SECONDS` | optional | 8–15; default 10 |
| `FENN_MARKET_WATCH_LEASE_KEY` | optional | default `market_watch` |
| `FENN_MARKET_WATCH_MAX_BLOCK_RANGE` | optional | default 500 |
| `ROBINHOOD_CHAIN_RPC_URL` | required for dry_run/live | HTTP RPC; never log |
| `NEXT_PUBLIC_SUPABASE_URL` | required | |
| `SUPABASE_SERVICE_ROLE_KEY` | required secret | |

# Database

Apply migrations:

1. `46_ops_runtime_leases` (if not already)
2. `50_market_watch_foundation`
3. Ops config from [`docs/market-watch-activation.sql`](./market-watch-activation.sql) — placeholders only

Verify: [`supabase/verify_market_watch.sql`](../supabase/verify_market_watch.sql)

# Activation (launch day)

1. Official `$FENN` row in `treasury_assets`.
2. Official pool deployed; verify `token0`/`token1`.
3. Upsert `market_watch_config` with **enabled=false**.
4. Set mode `dry_run`; compare Swap classify vs explorer.
5. Set `enabled=true`.
6. Set mode `live`.

# Failure policy

| Situation | Behaviour |
|-----------|-----------|
| Mode disabled | Worker sleeps; no chain fetch |
| Config incomplete | Fail closed; no cursor advance |
| RPC errors | Retry with backoff; fail tick; no silent allow |
| Classification hard error | Abort range; do **not** advance cursor |
| Dust / malformed swap | Persist `suppressed`; continue range |
| Cursor block hash mismatch | `mw_cursor_reorg`; stop advancing until replay/repair |
| Duplicate workers | Second instance lease-busy; sleeps without publishing |

# Replay

```bash
npm run market-watch:replay -- --from-block 100 --to-block 200
# live status path only with explicit flags:
npm run market-watch:replay -- --from-block 100 --to-block 200 --mode live --live-replay
```

Default: dry_run, does **not** advance cursor unless `--advance-cursor`.

# What 1.0A does not do

- Public Clearing feed merge
- Outlaw attribution
- USD pricing / whale labels
- WebSockets
- Desk UI panel

# Foundational law

A bare ERC-20 `Transfer` is never a buy. Only official pool canonical `Swap` logs classify acquisitions.
