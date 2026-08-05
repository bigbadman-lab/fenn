/**
 * Optional integration harness for a real Supabase project.
 *
 * Set CLEARING_INTEGRATION=1 and ensure migrations 47–49 are applied
 * with SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL available
 * (e.g. via .env.local + scripts/load-env).
 *
 * Without CLEARING_INTEGRATION=1 these tests are skipped so the default
 * suite stays offline-safe.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  sealTravellerCookie,
  generateTravellerId,
  openTravellerCookie,
} from "@/lib/clearing/cookie";
import { formatTravellerDisplayName, pickTravellerSurname } from "@/lib/clearing/names";

const enabled = process.env.CLEARING_INTEGRATION === "1";

describe("Clearing integration (optional real DB)", () => {
  it("skips unless CLEARING_INTEGRATION=1", { skip: !enabled }, async () => {
    assert.equal(enabled, true);
  });

  it(
    "mints traveller, posts three concurrent attempts, fourth fails at RPC",
    { skip: !enabled },
    async () => {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const admin = createAdminClient();
      const id = generateTravellerId();
      const displayName = formatTravellerDisplayName(pickTravellerSurname());
      const secret =
        process.env.FENN_CLEARING_COOKIE_SECRET?.trim() ||
        process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();

      const { error: mintErr } = await admin.from("clearing_travellers").insert({
        id,
        display_name: displayName,
      });
      assert.equal(mintErr, null, mintErr?.message);

      const cookie = sealTravellerCookie(id, { secret });
      assert.equal(openTravellerCookie(cookie, { secret }), id);

      const mkId = () => generateTravellerId();
      const bodies = [0, 1, 2, 3, 4].map((i) => ({
        p_author_type: "traveller",
        p_traveller_id: id,
        p_profile_id: null,
        p_display_name: displayName,
        p_body: `integration post ${i}`,
        p_client_request_id: mkId(),
      }));

      const results = await Promise.all(
        bodies.map((p) => admin.rpc("post_clearing_message", p)),
      );

      const accepted = results.filter((r) => !r.error && r.data);
      const rejected = results.filter((r) => r.error);

      assert.ok(accepted.length <= 3);
      assert.ok(rejected.length >= 2);

      const { count } = await admin
        .from("clearing_messages")
        .select("id", { count: "exact", head: true })
        .eq("traveller_id", id)
        .in("status", ["published", "hidden"]);

      assert.ok((count ?? 0) <= 3);
      assert.equal(count, accepted.length);

      // cleanup
      await admin.from("clearing_messages").delete().eq("traveller_id", id);
      await admin.from("clearing_travellers").delete().eq("id", id);
    },
  );

  it(
    "idempotent client_request_id does not double-insert",
    { skip: !enabled },
    async () => {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const admin = createAdminClient();
      const id = generateTravellerId();
      const displayName = formatTravellerDisplayName("Ash");
      await admin.from("clearing_travellers").insert({
        id,
        display_name: displayName,
      });
      const req = generateTravellerId();
      const params = {
        p_author_type: "traveller",
        p_traveller_id: id,
        p_profile_id: null,
        p_display_name: displayName,
        p_body: "same request twice",
        p_client_request_id: req,
      };
      const a = await admin.rpc("post_clearing_message", params);
      const b = await admin.rpc("post_clearing_message", params);
      assert.equal(a.error, null);
      assert.equal(b.error, null);
      const rowA = Array.isArray(a.data) ? a.data[0] : a.data;
      const rowB = Array.isArray(b.data) ? b.data[0] : b.data;
      assert.equal(rowA.id, rowB.id);
      const { count } = await admin
        .from("clearing_messages")
        .select("id", { count: "exact", head: true })
        .eq("traveller_id", id);
      assert.equal(count, 1);
      await admin.from("clearing_messages").delete().eq("traveller_id", id);
      await admin.from("clearing_travellers").delete().eq("id", id);
    },
  );
});
