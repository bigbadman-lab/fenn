# Stage P1D — Conversational wallet collection + confirmation

## Summary

When FENN decides `transfer_fenn` with a proposed amount but **no trusted destination** exists:

1. Economic decision is **preserved** (amount + reason frozen)
2. A durable `x_economic_interactions` row is created (`awaiting_wallet`)
3. FENN replies asking for a destination wallet
4. Same **immutable X user** (`author_x_user_id`) may supply a candidate `0x…`
5. FENN asks for explicit confirmation of a shortened address
6. On yes → wallet trusted **only for this interaction** → authority re-evaluates → `transfer_fenn` effect

Burn never enters this flow. Amount cannot be renegotiated mid-collection. No permanent X↔wallet identity.

## Identity

Security principal: `author_x_user_id` (immutable X snowflake text).  
Handle/username is never identity. Thread/conversation id may assist routing but is insufficient alone.

## Status machine

`awaiting_wallet` → `awaiting_wallet_confirmation` → `wallet_confirmed` → `executing` → `completed`  
Also: `cancelled` | `expired` | `failed`

Default TTL: 24h (`FENN_ECONOMIC_INTERACTION_TTL_MS`).

MVP: **one active interaction per** `author_x_user_id`.

## Authority

- Valid transfer without wallet → `pending_destination` (not ordinary NONE)
- Confirmed wallet re-enters with **original** `proposed_amount` + interaction-scoped address
- Still never clamps; limits may refuse

## Live routing

`judgeOneXPerception`: if an awaiting wallet/confirm interaction exists for the author, process wallet turn (no free economic re-judge).

`authorizeOneXPerception`: if interaction is `wallet_confirmed` with confirmed wallet and no transfer effect yet, inject frozen intent + confirmed address into economic plan.

## Harness (dry-run, in-memory)

```bash
npm run agent:test-wallet-collection -- --label demo --amount 25000
```

Negative (different user supplies wallet — rejected):

```bash
npm run agent:test-wallet-collection -- --label poison --poison-wallet-user
```

Unit tests:

```bash
npx tsx --conditions=react-server --test src/lib/agent/stage-p1d-wallet-collection.test.ts
```

## Migration

`supabase/migrations/20260809170000_59_stage_p1d_wallet_collection.sql`

## Out of scope

Permanent X→wallet mapping, Outlaw↔X linking, SIWE, amount negotiation, multi-pending per user, auto chain follow-up post (P1E).
