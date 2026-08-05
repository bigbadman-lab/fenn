/**
 * Optional live Robinhood Chain RPC checks (gated).
 *
 * MARKET_WATCH_RPC_INTEGRATION=1 + ROBINHOOD_CHAIN_RPC_URL
 * Never logs the RPC URL or API keys.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

const enabled = process.env.MARKET_WATCH_RPC_INTEGRATION === "1";
const hasRpc = Boolean(process.env.ROBINHOOD_CHAIN_RPC_URL?.trim());

describe("Market Watch RPC integration (optional)", () => {
  it(
    "skips unless MARKET_WATCH_RPC_INTEGRATION=1",
    { skip: !enabled },
    () => {
      assert.equal(enabled, true);
    },
  );

  it(
    "reads chain id 4663 and latest block without logging secrets",
    { skip: !enabled || !hasRpc },
    async () => {
      const { createMarketWatchRpcClient, assertRobinhoodChainId, withRpcRetry } =
        await import("@/lib/market-watch/rpc");
      const rpc = createMarketWatchRpcClient();
      await assertRobinhoodChainId(rpc);
      const latest = await withRpcRetry(() => rpc.getBlockNumber());
      assert.ok(latest > BigInt(0));
      // Historical bounded read near tip
      if (latest > BigInt(5)) {
        const meta = await rpc.getBlock({ blockNumber: latest - BigInt(2) });
        assert.ok(meta.hash);
      }
    },
  );
});
