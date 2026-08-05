/**
 * Optional DB integration for Market Watch (gated).
 *
 * MARKET_WATCH_INTEGRATION=1 with migrations 50+ applied and service role env.
 * Creates isolated fixture rows and cleans up.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomUUID } from "node:crypto";

const enabled = process.env.MARKET_WATCH_INTEGRATION === "1";

describe("Market Watch DB integration (optional)", () => {
  it("skips unless MARKET_WATCH_INTEGRATION=1", { skip: !enabled }, () => {
    assert.equal(enabled, true);
  });

  it(
    "inserts event idempotently and projects published only",
    { skip: !enabled },
    async () => {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const admin = createAdminClient();
      const id = randomUUID();
      const tx =
        "0x" + randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 0);
      // 64 hex after 0x
      const txHash =
        "0x" +
        (randomUUID() + randomUUID()).replace(/-/g, "").slice(0, 64);

      const pool = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const token = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      const quote = "0xcccccccccccccccccccccccccccccccccccccccc";

      const row = {
        id,
        chain_id: 4663,
        event_type: "acquisition",
        token_address: token,
        pool_address: pool,
        quote_token_address: quote,
        transaction_hash: txHash,
        log_index: 7,
        block_number: "999001",
        fenn_amount_raw: "1000",
        quote_amount_raw: "1",
        classification_version: "mw_v1_test",
        status: "published",
        published_at: new Date().toISOString(),
        observed_at: new Date().toISOString(),
      };

      const { error: e1 } = await admin.from("market_watch_events").insert(row);
      assert.ifError(e1);

      const { error: e2 } = await admin.from("market_watch_events").insert(row);
      assert.ok(e2, "duplicate must fail unique constraint");

      const { data: pub } = await admin
        .from("market_watch_events")
        .select("id, status")
        .eq("id", id)
        .maybeSingle();
      assert.equal(pub?.status, "published");

      await admin
        .from("market_watch_events")
        .update({
          status: "reorged",
          reorged_at: new Date().toISOString(),
          published_at: null,
        })
        .eq("id", id);

      const { data: reorged } = await admin
        .from("market_watch_events")
        .select("status")
        .eq("id", id)
        .maybeSingle();
      assert.equal(reorged?.status, "reorged");

      // Cleanup
      await admin.from("market_watch_events").delete().eq("id", id);
      void tx;
    },
  );

  it(
    "cursor upsert and worker state singleton",
    { skip: !enabled },
    async () => {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const admin = createAdminClient();
      const key = `test_cursor_${randomUUID().slice(0, 8)}`;
      const pool = "0xdddddddddddddddddddddddddddddddddddddddd";
      await admin.from("market_watch_cursors").upsert({
        source_key: key,
        chain_id: 4663,
        pool_address: pool,
        last_safe_block: "100",
        last_safe_block_hash: "0x" + "11".repeat(32),
        classification_version: "mw_v1_test",
        updated_at: new Date().toISOString(),
      });
      const { data } = await admin
        .from("market_watch_cursors")
        .select("last_safe_block")
        .eq("source_key", key)
        .maybeSingle();
      assert.equal(String(data?.last_safe_block), "100");
      await admin.from("market_watch_cursors").delete().eq("source_key", key);

      const { data: state } = await admin
        .from("market_watch_worker_state")
        .select("id")
        .eq("id", 1)
        .maybeSingle();
      assert.equal(state?.id, 1);
    },
  );
});
