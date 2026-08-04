/**
 * Production deployment layer for the FENN X Agent on Render.
 *
 * The website (including Desk and X OAuth callbacks) remains on **Vercel**.
 * **Render** only wakes the bounded agent runtime once per minute.
 * **Supabase** remains the system of record for queues, claims, tokens, and history.
 */

# Architecture

```text
Vercel                          Render cron (* * * * *)
├── Website                     └── npm run agent:run-x  (one shot, exits)
├── Desk
├── OAuth start / callback
└── Public APIs                       │
                                      ▼
                               Execution mode gate
                               (disabled | dry_run | live)
                                      │
                                      ▼
                               Postgres runtime lease
                               (ops_runtime_leases)
                                      │
                                      ▼
                               poll → judge → sight → authorize → execute
                                      │
                                      ▼
                               Supabase queues + OAuth tokens
```

| Owner    | Responsibility                                      |
|----------|-----------------------------------------------------|
| Vercel   | Website, Desk, OAuth callback, public APIs          |
| Render   | Minute schedule, pipeline process, cron logs        |
| Supabase | Queue, claims, OAuth tokens, effect history, leases |

# Service type

`npm run agent:run-x` is a **bounded one-shot process** (not a long-running worker).

Production uses a **Render Cron Job**:

- **Schedule:** `* * * * *` (every minute, UTC)
- **Build:** `npm ci`
- **Start:** `npm run agent:run-x`

Do not convert this runtime into an infinite worker merely to achieve one-minute cadence.

Blueprint file: [`render.yaml`](../render.yaml) at the repository root.

# Render setup

1. Apply Supabase migration `20260804120000_46_ops_runtime_leases.sql` (or latest that creates `ops_runtime_leases` + lease RPCs).
2. In Render, create a Blueprint from this repo (or create a Cron Job manually with the same schedule/commands).
3. Fill Blueprint `sync: false` secrets in the Dashboard (see matrix below).
4. Confirm `FENN_X_AGENT_EXECUTION_MODE=disabled` on first deploy.
5. Trigger a manual run and confirm logs show `mode=disabled result=noop`.

# GitHub deployment

1. Connect the GitHub repository to Render.
2. Deploy the Blueprint (`render.yaml`).
3. Render builds on push to the configured branch (`npm ci`).
4. Each schedule tick runs `npm run agent:run-x` and **must exit**.
5. OAuth remain on `NEXT_PUBLIC_SITE_URL` (Vercel), e.g. `https://imfenn.com/api/auth/x/callback`.

# Environment variables

## Matrix

| Variable | Class | Where | Notes |
|----------|-------|-------|-------|
| `FENN_X_AGENT_EXECUTION_MODE` | optional / Render-first | Render | `disabled` \| `dry_run` \| `live`; **default disabled** |
| `FENN_X_AGENT_BATCH_SIZE` | optional / Render | Render | Default `1` |
| `FENN_X_AGENT_MAX_RUNTIME_SECONDS` | optional / Render | Render | Default `50` (soft) |
| `FENN_X_AGENT_LEASE_KEY` | optional / Render | Render | Default `x_agent` |
| `NODE_VERSION` | optional / Render | Render | Pin Node 24.x |
| `NEXT_PUBLIC_SITE_URL` | required / public | Shared Vercel+Render | OAuth callback host |
| `NEXT_PUBLIC_SUPABASE_URL` | required / public | Shared | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | required / public | Shared | |
| `NEXT_PUBLIC_PRIVY_APP_ID` | required / public | Shared | |
| `SUPABASE_SERVICE_ROLE_KEY` | required / **secret** | Shared | Service role for claims/leases/tokens |
| `PRIVY_APP_SECRET` | required / **secret** | Shared | Runtime validation |
| `OPENAI_API_KEY` | required / **secret** | Shared | Judgement only when live work exists |
| `X_BEARER_TOKEN` | required / **secret** | Shared | Mention poll (live) |
| `FENN_X_USER_ID` | required | Shared | Digit snowflake for @askfenn |
| `X_OAUTH_CLIENT_ID` | required / **secret** | Shared | OAuth app (posts use DB tokens) |
| `X_OAUTH_CLIENT_SECRET` | required / **secret** | Shared | OAuth app |
| `FENN_X_USERNAME` | optional | Shared | Defaults askfenn |
| `X_API_KEY` / `X_API_SECRET` | optional | Shared | Legacy; not OAuth write path |
| `FENN_ADMIN_WALLETS` | optional | Vercel primarily | Admin OAuth start allowlist |
| `FENN_DESK_WALLETS` | optional | Vercel | Desk bind allowlist (not needed on Render) |
| `GREENWOOD_ACCESS_WALLETS` | optional | Shared if used | |
| `ROBINHOOD_CHAIN_RPC_URL` | optional | Shared if used | |
| `FENN_TREASURY_ADDRESS` | optional | Shared if used | |
| `CRON_SECRET` | optional / Vercel | Vercel | Living Book cron; **not** used by Render agent |

Never commit secret values. Blueprint uses `sync: false` for secrets (Dashboard prompts / Environment Groups).

# Execution modes

Controlled by `FENN_X_AGENT_EXECUTION_MODE`.

| Mode | Behaviour |
|------|-----------|
| `disabled` (default) | Env validates. No lease required. No claims. No OpenAI. No X. No Wall. Exit 0. Log `mode=disabled result=noop`. |
| `dry_run` | Lease + inspect queues / list pending effects. No public mutations (no X posts, no Wall writes, no effect claims). Logs what would happen. |
| `live` | Full pipeline with authority, OAuth, idempotency unchanged. |

Missing, blank, or invalid values resolve to **`disabled`**. Never default to `live`.

# Lease protection

Overlapping ticks use a **Postgres lease** (`ops_runtime_leases`), not an in-memory mutex.

```text
minute 0 → acquire lease → pipeline → release
minute 1 (overlap) → lease unavailable → log result=lease_busy → exit 0
```

Render also tries to avoid overlapping cron instances; the DB lease is the hard guarantee across restarts / manual triggers / multi-region mistakes.

# Runtime limits

| Env | Default | Behaviour |
|-----|---------|-----------|
| `FENN_X_AGENT_BATCH_SIZE` | `1` | Passed as stage `limit` (judge / sight / authorize / execute) |
| `FENN_X_AGENT_MAX_RUNTIME_SECONDS` | `50` | Soft budget: do not **start** new stages after the deadline; in-flight stage ops may finish |

# OAuth relationship

- Operators bind `@askfenn` via **Desk** on Vercel (`POST /api/desk/agent/oauth/start`).
- Callback stays `{NEXT_PUBLIC_SITE_URL}/api/auth/x/callback` (Vercel).
- Rotating tokens live in Supabase `x_oauth_credentials` (service_role only).
- Render never hosts OAuth UI or callbacks; it only uses stored credentials when executing `reply_on_x` in **live** mode.

# Manual deployment

1. Set secrets in Render Dashboard to match Vercel + agent requirements.
2. Mode remains `disabled`.
3. Deploy Blueprint.
4. Dashboard → Cron → **Trigger Run**.
5. Expect `mode=disabled result=noop`.

# Dry run

1. Ensure OAuth may be unbound (dry_run does not post).
2. Set `FENN_X_AGENT_EXECUTION_MODE=dry_run`.
3. Trigger a run; inspect `result=dry_run` and optional `would …` lines.
4. Confirm **no** public X posts and **no** Wall mutations.

# Live enablement

Only after desk binding and dry_run verification:

```text
FENN_X_AGENT_EXECUTION_MODE=live
```

# Monitoring

On each run, look for a single summary line, e.g.:

```text
mode=live duration=842ms perceptions=2 judgements=2 effects=1 posted=1 wall=0
mode=live result=no_work duration=221ms
mode=disabled result=noop
mode=live result=lease_busy duration=12ms
```

Never log tokens, secrets, prompts, or OAuth credentials.

When nothing is queued after poll, the runtime **skips** OpenAI/judge and X writes (no-work path).

# Rollback

1. Set `FENN_X_AGENT_EXECUTION_MODE=disabled` (immediate halt of effects).
2. Or suspend/delete the Render cron service.
3. Redeploy a previous git revision if code regression is suspected.
4. Queue/claims remain in Supabase — do not mass-delete effects without care.

# Troubleshooting

| Symptom | Check |
|---------|--------|
| `X agent runtime environment incomplete` | Missing required env (names only in error). |
| `mode=disabled` every minute | Expected until mode is changed. |
| `result=lease_busy` often | Previous run still holding lease / TTL too short / stuck process. Wait for TTL or inspect `ops_runtime_leases`. |
| Lease RPC errors | Apply migration `46_ops_runtime_leases`. |
| Live run but no posts | OAuth unbound; authority denied; empty effects; mode dry_run. |
| OpenAI spend on empty minutes | Should be `no_work` skip after empty probe — check logs. |
| OAuth callback fails | Fix Vercel URL / X developer portal allowlist — not Render. |

# Operator rollout

## Stage 1 — Deploy disabled

- Render cron live with `FENN_X_AGENT_EXECUTION_MODE=disabled`.
- Confirm noop logs every minute (or manual triggers).

## Stage 2 — Bind @askfenn

- Through Desk on Vercel.
- Confirm credentials row exists (Desk agent surface).

## Stage 3 — dry_run

- Switch mode to `dry_run`.
- Verify inspect logs; zero public mutations.

## Stage 4 — One controlled post

- Prefer existing Desk Wall test / carefully staged single effect, or a single manual tick after a known pending reply with extreme care.
- Verify publicly on X if a reply effect is expected.

## Stage 5 — live

- Set `FENN_X_AGENT_EXECUTION_MODE=live`.
- Cron runs every minute with batch size 1 and lease protection.

# Local ops

```bash
# load .env.local via scripts/load-env.ts
FENN_X_AGENT_EXECUTION_MODE=disabled npm run agent:run-x
FENN_X_AGENT_EXECUTION_MODE=dry_run npm run agent:run-x
# never use live against production tokens without intent
```

# Safety confirmation

Autonomous posting remains **disabled** until an operator explicitly sets:

```text
FENN_X_AGENT_EXECUTION_MODE=live
```
