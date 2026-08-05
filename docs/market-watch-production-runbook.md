/**
 * Market Watch production runbook (1.0D)
 *
 * Operational procedures for launch day. No product philosophy — steps and
 * recovery only. Real token/pool addresses never live in this repo.
 */

# Architecture (production)

| Surface | Role |
|---------|------|
| Render `fenn-market-watch` | Long-running worker · HTTP RPC poll ~10s |
| Supabase | config / events / cursors / worker_state / leases |
| Vercel | Clearing feed merge · Desk `/desk/market-watch` |

Default mode: **disabled**. Never live in source control.

# Secrets and env (Render)

Required (sync: false in Dashboard):

| Variable | Class |
|----------|--------|
| `ROBINHOOD_CHAIN_RPC_URL` | Secret HTTP RPC (Alchemy etc.) — never log |
| `NEXT_PUBLIC_SUPABASE_URL` | Public project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret service role |
| `FENN_MARKET_WATCH_MODE` | `disabled` \| `dry_run` \| `live` |

Optional:

| Variable | Default |
|----------|---------|
| `FENN_MARKET_WATCH_POLL_SECONDS` | 10 (clamped 8–15) |
| `FENN_MARKET_WATCH_LEASE_KEY` | `market_watch` |
| `FENN_MARKET_WATCH_MAX_BLOCK_RANGE` | 500 (adaptive down to floor 25) |

Mode is **environment-only**. Desk cannot toggle live.

# Thresholds (formal)

| Name | Value | Meaning |
|------|-------|---------|
| Heartbeat stale | 90s | Desk STALE / running false |
| Processing lag slack | +20 beyond confirmation | DEGRADED lag |
| Stalled lag | +200 beyond confirmation | STALLED lag |
| Reorg max rewind | 64 blocks | then operator replay |
| RPC attempts / tick | 3 | then fail tick |
| getLogs default span | 500 | halved on provider range errors |

# ACTIVATION SEQUENCE (required order)

1. Deploy official `$FENN` on Robinhood Chain.
2. Create official liquidity pool.
3. Record token address (must match `treasury_assets` official row).
4. Record pool address.
5. Record quote token address + decimals.
6. Determine pool kind: `uniswap_v2` or `uniswap_v3` only.
7. Record launch block (first block of pool interest).
8. Verify token0/token1 on-chain match {FENN, quote}.
9. Apply migrations **46** (leases) and **50** (Market Watch). Run `supabase/verify_market_watch.sql`.
10. Upsert `market_watch_config` with real fields and **`enabled=false`** (use placeholder SQL template only as structure).
11. Deploy `fenn-market-watch` with `FENN_MARKET_WATCH_MODE=disabled`. Confirm Desk heartbeat.
12. Set mode **`dry_run`**. Confirm Desk shows DRY RUN; config still enabled=false or leave false until verified.
13. Bounded dry-run:

```bash
npm run market-watch:verify -- --from-block N --to-block M
```

14. Compare each reported tx to Robinhood explorer Swap logs.
15. Calibrate `min_display_fenn_raw` from real sizes (integer raw units).
16. Confirm Desk: recent events, cursor, lag reasonable, no fatal classification errors.
17. Set config **`enabled=true`**.
18. Set `FENN_MARKET_WATCH_MODE=live`.
19. Watch first **published** acquisition → `/camp/clearing` as THE WOOD NOTICES.
20. Monitor lag, heartbeat CURRENT, reorg warnings.

Do not skip explorer compare. Do not jump disabled → live.

# EMERGENCY PAUSE

## Stop publication only (keep classifying)

1. Set Render `FENN_MARKET_WATCH_MODE=dry_run` **or**
2. SQL `UPDATE market_watch_config SET enabled=false WHERE id=1;`

Effects:

| Action | Ingestion | Publish to Clearing |
|--------|-----------|---------------------|
| mode=disabled | Off | Off |
| mode=dry_run | On (classify) | Never publishes |
| enabled=false (any mode) | Tick skips (config disabled) | Off |
| mode=live + enabled | On | Acquisitions above min |

## Stop worker process

Render dashboard → suspend/stop `fenn-market-watch` service.

## Preserve data

Never delete cursors or events during a pause.

# EMERGENCY RECOVER

1. Fix RPC / config / lease issue.
2. mode `dry_run` + `market-watch:verify` on affected ranges.
3. Optional: `npm run market-watch:replay -- --from-block N --to-block M` (dry default).
4. Live replay only with `--mode live --live-replay` when intentional.
5. Confirm Desk projection line ON before remaining live.
6. Resume mode=live only after explorer agreement.

# REORG HANDLING

## Automatic

1. Cursor hash mismatch detected.
2. Walk back ≤ 64 blocks for common ancestor.
3. Mark events with `block_number > ancestor` as **`reorged`** (clears published_at).
4. Rewind cursor to ancestor hash.
5. Forward process continues on later ticks.
6. Clearing drops reorged rows (feed `status=published` only).

## Desk messages

- Recovered: reorg log events; lag may spike then catch up.
- Stalled (`mw_reorg_stall`): rewind failed — **disable live**, inspect, CLI replay/verify, then resume.

## Reorg emergency

1. Set mode dry_run or disabled.
2. Inspect Desk reorged events + hashes.
3. Replay from safe ancestor range dry-run.
4. Confirm Clearing no longer shows reorged acquisition.
5. Live only after verification.

# RPC OUTAGE

- Tick fails after ≤3 retries with backoff/jitter.
- Cursor **not** advanced on failed range.
- Health lastErrorCode set; Desk DEGRADED/STALLED.
- Lease released/refreshed on next loop sleep.
- When RPC returns, backfill from last_safe+1.

# LEASE

- Key `market_watch` via `ops_runtime_leases`.
- Second instance lease-busy → skip tick (normal).
- Expired lease reclaimable. Event unique key is last line of defence against double publish.

# TOOLING

```bash
npm run market-watch:worker
npm run market-watch:verify -- --from-block N --to-block M
npm run market-watch:replay -- --from-block N --to-block M
# live only if intentional:
npm run market-watch:replay -- --from-block N --to-block M --mode live --live-replay
```

Gate tests:

```bash
MARKET_WATCH_INTEGRATION=1 npm test -- --test-name-pattern "Market Watch DB"
MARKET_WATCH_RPC_INTEGRATION=1 npm test -- --test-name-pattern "Market Watch RPC"
```

# RENDER LOGS TO WATCH

JSON lines `domain=market_watch`:

- `reorg_detected` / `reorg_recovered` / `reorg_stall`
- `rpc_rate_limited` / `rpc_retry` / `range_reduced`
- `classification_error` (fatal — cursor not advanced)
- `cursor_advanced` / `tick_end` ok=false
- `lease_skipped` (busy is OK; perpetual busy + no success is not)

# KNOWN LIMITATIONS

- Reorg deeper than 64 blocks needs human replay.
- Adaptive range memory is per-process (restarts start at configured max).
- No external pager/alert vendor — Render logs + Desk only.
- No automatic live from Desk.
- Sells never public.
- Buyer identity never attributed.

# Load note

Worker ~0.1 QPS for head + logs; Clearing public ~1 poll / 5s / reader; Desk 12s. Backfill raises getLogs volume — keep max range ≤500 and rely on adaptive floor 25 under provider pressure.
