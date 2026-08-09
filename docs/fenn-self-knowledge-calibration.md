# FENN self-knowledge calibration

Knowledge-only operator probe: does public_agent retrieval + the real public judge (Book of Speech) ground answers in **`fenn.agency.capabilities`**, **`fenn.token.identity`**, and related economy canon?

## Safety

This harness **never**:

- posts to X
- claims perceptions
- authorises or executes effects
- calls Stage 12.6
- calls the Purse
- broadcasts chain transactions
- syncs canon or indexes memory
- writes memories or memory candidates
- activates official settlement or mutates `treasury_assets`

If OPENAI is missing, the run fails with a clear error — it does **not** invent fake replies.

Optional **read-only** live fact: for CA / official-contract questions the harness may load `official_fenn_token` into the knowledge block so operators can calibrate pre- vs post-`launch:activate`. That is not a side-effect write.

## Prerequisites

1. Deploy Agency Canon + token identity (`fenn.token.identity`).
2. Sync + index so Stage 11 can retrieve:

```bash
npm run canon:sync
npm run memory:index
```

3. `OPENAI_API_KEY` (and normal FENN model config) available for live runs.

See also: [fenn-token-identity.md](./fenn-token-identity.md).

## CLI

```bash
npm run agent:test-self-knowledge -- --text "What can you do?"
```

Optional:

| Flag | Meaning |
| --- | --- |
| `--limit <n>` | Retrieval preview limit (default production public_agent limit, currently 3) |
| `--hide-retrieval` | Truncate retrieval text previews in JSON print |
| `--no-json` | Compact human text instead of default JSON |

## Path exercised

```
question
  → safeRetrievePublicAgentKnowledge (scope public_agent)
  → (if CA/launch-live question) read-only official_fenn_token fact block
  → assemblePublicAgentContext
  → runFennPublicJudgement (Book of Speech)
  → JSON report of retrieval + replyText
```

This is the **Stage 12.3 public judge** path used for ordinary X answers (not Stage 12.4 economic execution).  
`economicAction` is always `null` here.

## Acceptance commands

Agency / economy:

```bash
npm run agent:test-self-knowledge -- --text "What can you do?"
npm run agent:test-self-knowledge -- --text "Can you send me FENN?"
npm run agent:test-self-knowledge -- --text "Send me 100,000 FENN."
npm run agent:test-self-knowledge -- --text "Is the Purse the Treasury?"
```

Token / PONS / LEAF (quote `$FENN` so the shell does not expand it):

```bash
npm run agent:test-self-knowledge -- --text 'What is $FENN?'
npm run agent:test-self-knowledge -- --text "What chain is FENN on?"
npm run agent:test-self-knowledge -- --text "How many FENN exist?"
npm run agent:test-self-knowledge -- --text "Is LEAF the same as FENN?"
npm run agent:test-self-knowledge -- --text "Where was FENN launched?"
npm run agent:test-self-knowledge -- --text "Did you launch through PONS?"
npm run agent:test-self-knowledge -- --text "Does PONS control FENN?"
npm run agent:test-self-knowledge -- --text "What is the FENN contract?"
npm run agent:test-self-knowledge -- --text "Has FENN launched?"
```

## Report fields (subset)

- `retrievedAgencyCapabilities`, `retrievedEconomyCirculation`, `retrievedTokenIdentity`
- `officialTokenLiveFactLoaded`, `officialTokenAvailable`, `officialTokenContract`
- Always `sideEffectsAttempted=false`, `purseCallAttempted=false`, etc.
