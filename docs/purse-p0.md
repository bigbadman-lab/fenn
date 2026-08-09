# THE PURSE OF FENN — Stage P0 operator guide

Manual operator path only. **No autonomous AI spending.**

This stage proves that:

1. FENN has a dedicated Purse wallet (not Treasury).
2. The purse holds the official FENN ERC-20 on Robinhood Chain (4663).
3. Server-side ops code can transfer **exactly 1 FENN** to an operator-supplied address.
4. The same operation ID cannot create two intentional sends.
5. Completion requires on-chain confirmation.
6. Confirmed movements appear on `/commons` as **THE PURSE OF FENN**.

---

## Required environment variables

| Variable | Required for | Notes |
|----------|--------------|--------|
| `ROBINHOOD_CHAIN_RPC_URL` | balance reads + transfer | Server-only. Same RPC as Treasury reads. |
| `FENN_PURSE_PRIVATE_KEY` | transfer only | Server-only hex private key (`0x` + 64 hex). **Never** `NEXT_PUBLIC_*`. Never DB. Never logged. |
| `NEXT_PUBLIC_SUPABASE_URL` | all ops | Already required by FENN. |
| `SUPABASE_SERVICE_ROLE_KEY` | settlement + lock RPCs | Server-only. |

Optional shared env used by existing Stage 9 tooling stays unchanged.

---

## Create the dedicated Purse wallet

1. Create a **new** EVM keypair offline (hardware wallet export of a dedicated account, `cast wallet new`, or equivalent).
2. **Do not** reuse the Treasury address.
3. Record the public address as lowercase `0x` + 40 hex.
4. Store the private key only in server secrets:
   - local: `.env.local` as `FENN_PURSE_PRIVATE_KEY=0x...`
   - production: host secret manager / Render / Vercel env — never git
5. Never paste the private key into SQL, Supabase, Chat, tickets, or screenshots.

---

## Fund the Purse (small test only)

On **Robinhood Chain (4663)**:

1. Send a **small** amount of official FENN (e.g. 2–5 for a few P0 tests) to the Purse public address.
2. Send a small amount of native gas token (ETH on Robinhood) for transaction fees.
3. Do **not** fund with arbitrary ERC-20s for this stage — P0 will not transfer them.

Official token resolution comes from `treasury_assets` (existing Stage 9 official FENN row). The Purse module never configures a second token address as truth.

---

## Configure `purse_config`

Apply migration:

```text
supabase/migrations/20260808120000_53_purse_p0.sql
```

Then insert the singleton config (example scaffolding — not a migration):

```text
supabase/examples/purse_p0_ops_example.sql
```

The address must match the account derived from `FENN_PURSE_PRIVATE_KEY`. A mismatch fails closed with `purse_key_address_mismatch`.

---

## Execute the manual 1 FENN test

From a machine that has:

- migration applied
- `purse_config` row
- env vars set
- official FENN token resolvable

```bash
npm run purse:transfer-one -- \
  --to 0xYOUR_TEST_RECIPIENT_LOWERCASE \
  --operation-id p0-manual-001
```

Amount is **fixed to 1 FENN**. There is no amount flag.

The CLI prints a safe preview first:

- purse public address
- recipient
- official token address
- chain id / name
- amount = 1

Then executes and waits for confirmation.

### Idempotency

Re-run with the **same** `--operation-id`:

- If already confirmed → returns the existing `txHash` (`reusedExisting: true`), no new send.
- If a `txHash` is known but not confirmed → reconciles that transaction, does not rebroadcast.
- If status is `ambiguous` without a recoverable path → fails closed; **do not invent a new operation** for the same intent until you inspect chain state.

Use a **new** `operation-id` only for an intentional second transfer.

---

## Verify the transaction

1. CLI JSON includes `txHash` and `confirmedAt` when `ok: true`.
2. Robinhood explorer: `https://robinhoodchain.blockscout.com/tx/<txHash>`
3. SQL:

```sql
SELECT operation_id, status, recipient_address, amount_formatted, tx_hash, confirmed_at, failure_class, last_error
FROM public.purse_transfers
ORDER BY created_at DESC
LIMIT 20;
```

4. Open `/commons` → **THE PURSE OF FENN**:
   - address
   - live FENN balance
   - confirmed MOVEMENTS only

---

## If settlement becomes ambiguous

Meaning:

- CLI returns `code: "purse_ambiguous"`, or
- row `status = 'ambiguous'`, or
- send possibly happened but confirmation did not complete.

**Do not rebroadcast with a different operation id for the same intent until you know what happened.**

1. If `tx_hash` is present on the row, check the explorer/receipt.
2. Re-run the **same** `operation-id` to attempt reconciliation (never a blind second send).
3. If there is no `tx_hash`, inspect the Purse address nonce/balance on-chain before any further action.
4. Prefer manual human resolution over automating a second send.

---

## Security guarantees (P0)

- Private key only via `FENN_PURSE_PRIVATE_KEY` (env).
- Public readers / Commons never see keys or internal failure text for unconfirmed rows.
- Clients cannot write `purse_config` / `purse_transfers` (RLS + revoked writes).
- Transfer path is ERC-20 `transfer()` of the official FENN token only.
- Native transfers forbidden by module policy.
- One transfer at a time (Postgres advisory lock).
- X agent, authority, effects, and Stage 11 knowledge are unmodified.
- Pre-launch **disposable test token is isolated** from official FENN resolution (see below).

---

## PRE-LAUNCH DISPOSABLE TOKEN TEST

Use this **only** before official `$FENN` exists, on a **local/operator** machine.

### Required test env vars

| Variable | Value | Notes |
|----------|--------|--------|
| `FENN_PURSE_TEST_MODE` | **must be exactly** `explicit_allow` | Not `true` / `1` / boolean-ish |
| `FENN_PURSE_TEST_TOKEN_ADDRESS` | disposable ERC-20 on chain **4663** | Normalized `0x`… address |
| `FENN_PURSE_TEST_TOKEN_DECIMALS` | integer `0`–`255` | Used to convert amount `"1"` → raw units |

Also needed (shared with production P0):

- `FENN_PURSE_PRIVATE_KEY`
- `ROBINHOOD_CHAIN_RPC_URL`
- `purse_config` wallet matching the key
- gas on the Purse wallet + balance of the **disposable** ERC-20

### Hard rules

- **Local / operator-only.** Refuses when `NODE_ENV=production` or `VERCEL_ENV=production`.
- **Not used by** `npm run purse:transfer-one` — that path never reads `FENN_PURSE_TEST_*`.
- Disposable token must **never** be marked `metadata.official` / `public_contract` in `treasury_assets`.
- Once official FENN successfully resolves, **`purse:transfer-one-test` refuses permanently** (no override).
- Confirmed test rows set `is_test = true` and are **excluded** from public RLS and `/commons` MOVEMENTS.
- Amount fixed at **1** test token (same as P0 unit size).

### Run a test transfer

```bash
npm run purse:transfer-one-test -- \
  --to 0xYOUR_TEST_RECIPIENT_LOWERCASE \
  --operation-id test:p0-manual-001
```

Preview prints:

- `mode: "TEST"`
- `amount: "1"`
- disposable `tokenAddress`
- `chainId: 4663`
- purse + recipient
- `warning: "NOT OFFICIAL FENN"`

Private key is never printed.

### Verify

1. CLI JSON: `ok: true`, `txHash`, `confirmedAt`, `isTest: true`.
2. Robinhood explorer for the `txHash`.
3. Ops SQL (service role / admin — not public client):

```sql
SELECT operation_id, status, is_test, token_address, amount_formatted, tx_hash, confirmed_at, actor_id
FROM public.purse_transfers
WHERE is_test = true
ORDER BY created_at DESC
LIMIT 20;
```

4. `/commons` must **not** show the row under THE PURSE OF FENN movements.

### Idempotency

Re-run the **same** `--operation-id`:

- Already confirmed → reuse `txHash`, no second send.
- Known `tx_hash` → reconcile only.
- Ambiguous without safe reconcile → fail closed; do not invent a new op-id for the same intent until inspected.

### Launch cleanup (when official $FENN is ready)

1. **Remove** from every host/env:

   - `FENN_PURSE_TEST_MODE`
   - `FENN_PURSE_TEST_TOKEN_ADDRESS`
   - `FENN_PURSE_TEST_TOKEN_DECIMALS`

2. Configure **real** official FENN via existing `treasury_assets` official + `public_contract` mechanism (not the disposable token).

3. Fund the **same** Purse wallet with real FENN + gas.

4. Verify normal path:

   ```bash
   npm run purse:transfer-one -- --to 0x… --operation-id p0-live-001
   ```

   resolves official FENN.

5. Verify test rail **refuses** because official FENN exists:

   ```bash
   npm run purse:transfer-one-test -- --to 0x… --operation-id test:should-fail
   ```

   expect `purse_test_mode_official_fenn_exists` (or inactive if envs already removed).

6. Leave historical `is_test = true` rows in the DB for ops audit; never expose them publicly.

---

## Explicit non-goals (still NOT live)

- Autonomous AI spending
- Model-originated X agent `transfer_fenn` effects (Stage **P1A** executes controlled tests only — see `docs/agent-purse-p1a.md`)
- Multi-turn wallet collection on X
- Greenwood contribution of knowledge
- Arbitrary amounts / tokens / chains
- Treating disposable test token as official FENN
