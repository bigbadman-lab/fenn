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
2. Robinhood explorer: `https://explorer.robinhood.com/tx/<txHash>`
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

---

## Explicit non-goals (still NOT live)

- Autonomous AI spending
- X agent `transfer_fenn` effects
- Multi-turn wallet collection on X
- Greenwood contribution of knowledge
- Arbitrary amounts / tokens / chains
