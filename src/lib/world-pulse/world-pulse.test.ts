import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  WORLD_PULSE_COMMONS_MS,
  WORLD_PULSE_DEEDS_MS,
  WORLD_PULSE_GREENWOOD_FIRE_MS,
  WORLD_PULSE_GREENWOOD_GATHERING_MS,
  WORLD_PULSE_GREENWOOD_HOLLOW_MS,
  WORLD_PULSE_LEDGER_MS,
  WORLD_PULSE_PROFILE_FOCUS_MIN_MS,
  WORLD_PULSE_WALL_MS,
} from "@/lib/world-pulse/intervals";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

describe("World Pulse intervals", () => {
  it("uses bounded MVP cadences", () => {
    assert.equal(WORLD_PULSE_COMMONS_MS, 60_000);
    assert.equal(WORLD_PULSE_WALL_MS, 25_000);
    assert.equal(WORLD_PULSE_DEEDS_MS, 60_000);
    assert.equal(WORLD_PULSE_LEDGER_MS, 25_000);
    assert.equal(WORLD_PULSE_GREENWOOD_FIRE_MS, 25_000);
    assert.equal(WORLD_PULSE_GREENWOOD_GATHERING_MS, 25_000);
    assert.equal(WORLD_PULSE_GREENWOOD_HOLLOW_MS, 60_000);
    assert.ok(WORLD_PULSE_PROFILE_FOCUS_MIN_MS >= 10_000);
  });
});

describe("World Pulse wiring", () => {
  it("commons mounts a 60s page pulse without clientifying the page", () => {
    const page = read("src/app/commons/page.tsx");
    assert.match(page, /PagePulse/);
    assert.match(page, /WORLD_PULSE_COMMONS_MS/);
    assert.match(page, /force-dynamic/);
    assert.match(page, /loadCommonsPageData/);
    // Exactly one client pulse mount — no duplicate intervals.
    assert.equal((page.match(/<PagePulse/g) ?? []).length, 1);
    assert.doesNotMatch(page, /^["']use client["']/m);
    assert.doesNotMatch(page, /createRobinhoodPublicClient|ROBINHOOD_CHAIN_RPC/);
    assert.doesNotMatch(page, /WebSocket|useSWR|setInterval/);
  });

  it("PagePulse refreshes RSC via router without browser RPC", () => {
    const pulse = read("src/components/world-pulse/page-pulse.tsx");
    assert.match(pulse, /router\.refresh\(\)/);
    assert.match(pulse, /refreshOnVisible:\s*true/);
    assert.match(pulse, /usePagePulse/);
    assert.doesNotMatch(pulse, /getBalance|balanceOf|ROBINHOOD_CHAIN|viem/);
    assert.doesNotMatch(pulse, /mock|fixture|placeholder.*balance/i);
  });

  it("usePagePulse skips hidden tabs, resumes, and avoids overlap", () => {
    const hook = read("src/hooks/use-page-pulse.ts");
    assert.match(hook, /document\.hidden/);
    assert.match(hook, /visibilitychange/);
    assert.match(hook, /clearInterval/);
    assert.match(hook, /removeEventListener/);
    assert.match(hook, /refreshOnVisible/);
    assert.match(hook, /pulsing/);
    assert.doesNotMatch(hook, /postgres_changes|useSWR|React Query|WebSocket/);
  });

  it("commons treasury path stays live on each SSR pass", () => {
    const loader = read("src/lib/commons/page-data.ts");
    const snapshot = read("src/lib/treasury/snapshot.ts");
    const chain = read("src/lib/treasury/chain.ts");
    const api = read("src/app/api/treasury/route.ts");
    const readout = read("src/components/commons/treasury-readout.tsx");
    assert.match(loader, /getPublicTreasurySnapshot/);
    assert.match(snapshot, /readNativeBalance/);
    assert.match(snapshot, /readErc20Balance/);
    assert.match(chain, /getBalance/);
    assert.match(chain, /balanceOf/);
    assert.match(api, /no-store|force-dynamic/);
    assert.match(readout, /formatTreasuryObservedAt/);
    assert.match(readout, /dateTime=\{treasury\.observedAt\}/);
    assert.doesNotMatch(snapshot, /mockBalance|fixtureBalance|SAMPLE_/);
  });

  it("wall mounts a 25s page pulse and stays SSR", () => {
    const page = read("src/app/wall/page.tsx");
    assert.match(page, /PagePulse/);
    assert.match(page, /WORLD_PULSE_WALL_MS/);
    assert.match(page, /listPublicWallEntries/);
    assert.match(page, /force-dynamic/);
    assert.doesNotMatch(page, /^["']use client["']/m);
    assert.doesNotMatch(page, /writeFennWallEntry|postgres_changes|\.channel\(/);
  });

  it("deeds board pulses periodically; detail uses visibility+deadline only", () => {
    const board = read("src/app/deeds/page.tsx");
    const detail = read("src/app/deeds/[slug]/page.tsx");
    assert.match(board, /DeedsBoardPulse/);
    assert.match(detail, /DeedsDetailPulse/);
    assert.doesNotMatch(detail, /DeedsBoardPulse/);

    const deedsPulse = read("src/components/world-pulse/deeds-pulse.tsx");
    assert.match(deedsPulse, /WORLD_PULSE_DEEDS_MS/);
    assert.match(deedsPulse, /visibilitychange/);
    assert.match(deedsPulse, /Preserves submission form/);
  });

  it("greenwood and profile refresh quietly on visibility", () => {
    const gate = read("src/components/greenwood/greenwood-gateway.tsx");
    assert.match(gate, /loadStatus\(\{ quiet: true \}\)/);
    assert.match(gate, /visibilitychange/);
    assert.match(gate, /must not eject an open member interior/);

    const auth = read("src/components/auth/fenn-auth-provider.tsx");
    assert.match(auth, /WORLD_PULSE_PROFILE_FOCUS_MIN_MS/);
    assert.match(auth, /refreshMe\(\{ quiet: true \}\)/);
    assert.match(auth, /visibilitychange/);
  });

  it("does not touch ledger shell or add realtime", () => {
    assert.ok(existsSync(join(repo, "src/app/ledger/page.tsx")));

    for (const rel of [
      "src/hooks/use-page-pulse.ts",
      "src/components/world-pulse/page-pulse.tsx",
      "src/components/world-pulse/deeds-pulse.tsx",
    ]) {
      const source = read(rel);
      assert.doesNotMatch(source, /postgres_changes|\.channel\(|useSWR|Realtime/);
    }
  });
});
