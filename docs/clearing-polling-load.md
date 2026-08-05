# Clearing — polling load notes (1.0D)

## Model

- `GET /api/clearing/feed` every **`CLEARING_PUBLIC_POLL_MS` (5000 ms)** while document visible.
- Hidden tab: interval paused.
- No Realtime / WebSockets in 1.0D.
- Feed uses service_role server-side; published-only; newest page + cursor for older.

## Order-of-magnitude request rates

Assume every concurrent reader polls every 5s:

| Concurrent readers | Feed req/s | Feed req/min |
|--------------------|------------|----------------|
| 100 | 20 | 1 200 |
| 1 000 | 200 | 12 000 |
| 5 000 | 1 000 | 60 000 |

Plus posts + Traveller mints (orders of magnitude lower for community launch).

## Indexed path

- Partial index `clearing_messages_feed_idx` on `(created_at DESC, id DESC) WHERE status = 'published'`.
- Poll currently re-fetches the newest page (merge/dedupe in client). Full history is not reloaded each tick.

## Optimizations present

- Visibility pause
- Overlap guard
- Client merge by id
- `Cache-Control: no-store` (correct for conversation; no stale edge cache)

## Further optimizations (later, not 1.0D)

- `since` / `If-None-Match` for empty/no-change polls
- Slightly larger poll interval under load feature-flag
- CDN only if private cache semantics carefully designed (usually avoid)

## Launch recommendation

**Stay at 5 seconds.**

Trade-off: slightly less “live” than 4s; better headroom on Vercel function concurrency and Supabase read QPS for early community size.
