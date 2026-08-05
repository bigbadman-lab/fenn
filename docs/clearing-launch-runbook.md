# The Clearing — launch-day runbook (1.0D)

Operational checklist. Not product lore.

## Production config (required)

| Variable | Class | Notes |
|----------|--------|--------|
| `FENN_CLEARING_COOKIE_SECRET` | **required production secret** | min 32 characters; dedicated HMAC secret for Traveller cookies. **Required when `NODE_ENV=production` or `VERCEL_ENV=production`.** Never fall back to service role in production. |
| `SUPABASE_SERVICE_ROLE_KEY` | required foundation | API only; not a cookie secret in production. |
| `FENN_DESK_WALLETS` | required for Desk | Keepers who can moderate. |
| Rate limits / poll intervals | code defaults in `src/lib/clearing/config.ts` | Tune via deploy; `clearing_state` holds read-only + slow mode. |

### Environments

- **Local:** set `FENN_CLEARING_COOKIE_SECRET` (recommended); may fall back to service role when not production.
- **Vercel production:** set dedicated cookie secret; fail closed if missing.
- **Preview:** if `VERCEL_ENV=production` only is treated as production; previews with `NODE_ENV=production` still require the dedicated secret (safer). Prefer setting the secret on all Vercel envs.

### Secret rotation

Rotating `FENN_CLEARING_COOKIE_SECRET` invalidates existing Traveller cookies. Users re-mint a new Traveller name (and a new three-message allowance). Message history remains; new cookie is a new identity row.

---

## Before opening

1. Apply migrations **47**, **48**, **49** (authorised).
2. Run `supabase/verify_clearing_foundation.sql` — expect OK, no public write grants.
3. Confirm `FENN_CLEARING_COOKIE_SECRET` in production.
4. Confirm Desk wallet on `FENN_DESK_WALLETS`.
5. Smoke:
   - mint Traveller + one message
   - Outlaw message
   - hide / restore
   - mute / unmute Traveller
   - read-only on → post blocked → reopen
   - slow mode 10s
   - Desk health line: db/state/rate RPC/cookie ok
6. Open `/camp/clearing` and `/desk/clearing` in a second browser profile.

---

## During launch

- **Monitor:** `/desk/clearing` (15s poll) + moderation history.
- **Slow mode first** when volume spikes (3–10s); reserve read-only for abuse waves.
- **Spam:** hide message → mute short → ban if repeat.
- **Outlaw scope:** CLEARING VOICE ONLY — does not affect LEAF/Greenwood/Camp.
- Confirm public feed still renders while read-only (no new posts).

---

## Emergency: close new voices

1. Desk → **CLOSE THE CLEARING TO NEW VOICES** (read-only).
2. Feed remains readable.
3. Inspect moderation log + logs (`domain=clearing` JSON).
4. Hide abusive rows; mute/ban as needed.
5. When calm: **REOPEN THE CLEARING**; optionally keep slow mode.

### Shutdown order of preference

1. Read-only (fastest, reversible)
2. Slow mode 60s
3. Scale deploy / fix DB
4. Only as last resort: take app offline

---

## After launch

- Review rate-limit and mint blocks in logs.
- Review moderation log for patterns.
- Tune `CLEARING_PUBLIC_POLL_MS` (default **5s**) if load justifies.
- Purge test messages if any seeded in shared DB (rare).

---

## Failure handling (posting)

| Situation | Behaviour |
|-----------|-----------|
| State DB unreachable | Post **fails closed** (503) |
| Rate RPC down | Post **fails closed** (503) — no silent allow |
| Identity unknown | 401; client may re-mint Traveller |
| Lost response after accept | Retry same `clientRequestId` → same row, **no double count** |
| Mute/ban/read-only | Fail closed; truthful Desk status |

---

## Client request ID policy

- **New composition:** new UUID.
- **Retry after network drop / ambiguous failure:** same UUID.
- **After clear `registration_required`, `invalid_body`, or successful send:** new UUID.
- **After rate_limit / slow_mode:** may reuse body; new or same ID OK; do not assume success.

---

## Polling (launch)

- Public: **5 seconds**, pause when tab hidden, no overlapping fetches.
- Desk: **15 seconds**.
- Trade-off: 4s felt livelier; 5s cuts request load ~20% for the same concurrent readers.
