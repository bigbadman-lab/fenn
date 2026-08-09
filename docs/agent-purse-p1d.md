# Stage P1D — Conversational wallet collection + confirmation

## Summary

Economic merit is independent of destination. FENN may decide `transfer_fenn` + amount even with **no trusted wallet**.

When FENN decides `transfer_fenn` with a proposed amount but **no trusted destination** exists:

1. Economic decision is **preserved** (amount + reason frozen)
2. A durable `x_economic_interactions` row is created (`awaiting_wallet`)
3. FENN replies asking for a destination wallet (Book of Speech)
4. Same **immutable X user** (`author_x_user_id`) may supply a candidate `0x…`
5. FENN asks for explicit confirmation of a shortened address (Book of Speech)
6. On yes → wallet trusted **only for this interaction** → authority re-evaluates → `transfer_fenn` effect
7. If authority refuses → FENN-voice refusal reply; no silent optimistic “I will send”

Burn never enters this flow. Amount cannot be renegotiated mid-collection. No permanent X↔wallet identity.

Stage 12.4 must **not** choose NONE merely because destination is missing.

## Voice law (P1D.1)

**APPLICATION OWNS TRUTH. FENN OWNS THE WORDS.**

| Layer | Owns |
|-------|------|
| Application / wallet FSM / authority | action, amount, wallets, settlement, refusal category |
| THE BOOK OF SPEECH wallet speech writer | cadence, wording, personality |

The model may change **how** something is said. It may **never** change transactional facts.

Live path:

```
deterministic WalletSpeechFacts
  → Book-of-Speech wallet writer
  → transactional fact validation
  → (skip unconstrained quality rewrite while interaction active)
  → authority / effect packaging
  → X
```

If the voice model fails or fails validation: **deterministic fallback** copy is posted (logged as `fallback_voice`). Fallback never weakens economic safety or invents settlement.

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
- Still never clamps; limits may refuse with user-facing refusal speech

## Live routing

`judgeOneXPerception`: if an awaiting wallet/confirm interaction exists for the author, process wallet turn (no free economic re-judge). Speech via Book of Speech.

`authorizeOneXPerception`: pending destination creates interaction + BoS ask; wallet_confirmed re-plans transfer; refuse → mark failed + BoS refusal reply.

## Harness (dry-run, in-memory)

```bash
npm run agent:test-wallet-collection -- --label demo --amount 25000
```

Unit tests:

```bash
npx tsx --conditions=react-server --test \
  src/lib/agent/stage-p1d-wallet-collection.test.ts \
  src/lib/agent/stage-p1d1-wallet-speech.test.ts
```

## Migration

`supabase/migrations/20260809170000_59_stage_p1d_wallet_collection.sql`

## Out of scope

Permanent X→wallet mapping, Outlaw↔X linking, SIWE, amount negotiation, multi-pending per user, auto chain follow-up post (P1E).
