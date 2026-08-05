/**
 * Market Watch — official pool Swap observation worker (through 1.0D).
 *
 * Separated from the X-agent cron. Long-running Render background worker.
 * Website and Desk on Vercel. Supabase is the system of record.
 *
 * Production ops: see [market-watch-production-runbook.md](./market-watch-production-runbook.md).
 */

# Architecture

```text
Vercel                              Render worker (always-on)
├── Website / Clearing feed         └── npm run market-watch:worker
├── Desk /api/desk/market-watch             │
└── (no mode controls)                      ▼
                                     FENN_MARKET_WATCH_MODE
                                     disabled | dry_run | live
                                            │
                                            ▼
                                     ops_runtime_leases
                                     lease_key = market_watch
                                            │
                                            ▼
                                     HTTP RPC poll (≈10s)
                                     adaptive getLogs + reorg recovery
                                            │
                                            ▼
                                     classify → persist → cursor
                                     market_watch_* tables
```

| Owner    | Responsibility |
|----------|----------------|
| Vercel   | Website, Clearing feed, Desk `/desk/market-watch` |
| Render   | Always-on worker `fenn-market-watch` |
| Supabase | Config, events, cursors, worker state, leases |

# Service type

`npm run market-watch:worker` is a **long-running** process.

Render: **Background Worker** in [`render.yaml`](../render.yaml). Default mode **disabled**.

# Required env

| Variable | Class | Notes |
|----------|-------|-------|
| `FENN_MARKET_WATCH_MODE` | Render-first | `disabled` \| `dry_run` \| `live`; default disabled |
| `FENN_MARKET_WATCH_POLL_SECONDS` | optional | 8–15; default 10 |
| `FENN_MARKET_WATCH_LEASE_KEY` | optional | default `market_watch` |
| `FENN_MARKET_WATCH_MAX_BLOCK_RANGE` | optional | default 500; adaptive floor 25 |
| `FENN_MARKET_WATCH_RPC_TIMEOUT_MS` | optional | default 20000 |
| `ROBINHOOD_CHAIN_RPC_URL` | secret | HTTP RPC; never log |
| `NEXT_PUBLIC_SUPABASE_URL` | required | |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | |

# Database

1. Migration `46_ops_runtime_leases`
2. Migration `50_market_watch_foundation`
3. Ops: [`docs/market-watch-activation.sql`](./market-watch-activation.sql) placeholders only
4. Verify: [`supabase/verify_market_watch.sql`](../supabase/verify_market_watch.sql)

# Tooling

```bash
npm run market-watch:worker
npm run market-watch:verify -- --from-block N --to-block M
npm run market-watch:replay -- --from-block N --to-block M
npm run market-watch:replay -- --from-block N --to-block M --reclassify
# live only when intentional:
npm run market-watch:replay -- --from-block N --to-block M --mode live --live-replay
```

- **verify** — dry-run classify report for explorer compare; no publish; no cursor.
- **replay** — bounded re-process; default dry_run; optional `--reclassify` for observed/suppressed only.

# Failure policy

| Situation | Behaviour |
|-----------|-----------|
| Mode disabled | Worker sleeps; no chain fetch |
| Config incomplete / disabled | Fail closed; no cursor advance |
| RPC errors | ≤3 retries + backoff/jitter; fail tick; no cursor advance |
| Provider range limit | Halve getLogs span to floor 25 |
| Canonical Swap decode fail | fatal; no cursor advance; ops sees tx:log |
| Dust / expected suppress | Persist `suppressed`; continue |
| Cursor hash mismatch | Automatic reorg recovery (≤64 blocks) or stall |
| Reorg recovered | Events after ancestor → `reorged`; Clearing drops them |
| Duplicate workers | Lease busy; unique event key is backstop |

# Activation

Full ordered checklist: [market-watch-production-runbook.md](./market-watch-production-runbook.md)

# Integration tests (optional)

```bash
MARKET_WATCH_INTEGRATION=1 npm test -- --test-name-pattern "Market Watch DB"
MARKET_WATCH_RPC_INTEGRATION=1 npm test -- --test-name-pattern "Market Watch RPC"
```

Never logged: RPC URLs, service keys.

# What Market Watch does not do

- Buyer attribution / wallet identity in Clearing
- Public sells
- AI observations
- Desk live activation controls
- WebSockets / Realtime
- Automatic live mode
