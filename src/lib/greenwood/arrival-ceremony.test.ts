import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  viewFromAdmissionResult,
  viewFromGreenwoodStatus,
} from "./gate-view";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

const memberBase = {
  greenwoodEnteredAt: "2026-08-02T12:00:00.000Z",
  thresholdAtEntry: 30,
  lifetimeLeafAtEntry: 34,
  currentLifetimeLeaf: 34,
  standingRank: 1,
  standingTotalMembers: 3,
  sigil: null,
} as const;

describe("Greenwood arrival ceremony — gate mapping", () => {
  it("shows ceremony for newly admitted members", () => {
    const mapped = viewFromAdmissionResult({
      status: "admitted",
      ...memberBase,
      arrivalCeremonyPending: true,
    });
    assert.equal(mapped.view, "member");
    assert.equal(mapped.member?.arrivalCeremonyPending, true);
  });

  it("shows ceremony when status reports pending completion", () => {
    const mapped = viewFromGreenwoodStatus({
      state: "member",
      ...memberBase,
      arrivalCeremonyPending: true,
    });
    assert.equal(mapped.view, "member");
  });

  it("enters interior when ceremony is complete", () => {
    const mapped = viewFromGreenwoodStatus({
      state: "member",
      ...memberBase,
      arrivalCeremonyPending: false,
    });
    assert.equal(mapped.view, "interior");
  });

  it("treats backfilled already_member without pending as interior", () => {
    const mapped = viewFromAdmissionResult({
      status: "already_member",
      ...memberBase,
      arrivalCeremonyPending: false,
    });
    assert.equal(mapped.view, "interior");
  });

  it("keeps already_member on ceremony when completion is still pending", () => {
    const mapped = viewFromAdmissionResult({
      status: "already_member",
      ...memberBase,
      arrivalCeremonyPending: true,
    });
    assert.equal(mapped.view, "member");
  });

  it("does not invent member views for non-members", () => {
    const mapped = viewFromGreenwoodStatus({
      state: "eligible",
      lifetimeLeaf: 40,
      threshold: 30,
      remainingLeaf: 0,
      greenwoodEnteredAt: null,
    });
    assert.equal(mapped.view, "eligible");
    assert.equal(mapped.member, undefined);
  });
});

describe("Greenwood arrival ceremony — source contracts", () => {
  it("migration adds durable column, backfill, and idempotent RPC", () => {
    const migration = read(
      "supabase/migrations/20260802100000_38_greenwood_arrival_ceremony.sql",
    );
    assert.match(
      migration,
      /greenwood_arrival_ceremony_completed_at/,
    );
    assert.match(
      migration,
      /SET greenwood_arrival_ceremony_completed_at = greenwood_entered_at/,
    );
    assert.match(
      migration,
      /complete_greenwood_arrival_ceremony/,
    );
    assert.match(migration, /already_completed/);
    assert.match(migration, /not_member/);
    assert.match(migration, /GRANT EXECUTE[\s\S]*TO service_role/);
    assert.doesNotMatch(migration, /GRANT EXECUTE[\s\S]*TO authenticated/);
    assert.doesNotMatch(migration, /localStorage/);
  });

  it("gateway uses full-screen arrival ceremony and completion API", () => {
    const gateway = read("src/components/greenwood/greenwood-gateway.tsx");
    assert.match(gateway, /GreenwoodArrivalCeremony/);
    assert.match(gateway, /postGreenwoodArrivalCeremonyComplete/);
    assert.match(gateway, /ceremonyFinishedThisSession/);
    assert.doesNotMatch(gateway, /GreenwoodFirstCrossingTransition/);
    assert.doesNotMatch(gateway, /localStorage/);
  });

  it("arrival ceremony is full-screen, reduced-motion safe, and failsafe timed", () => {
    const ui = read(
      "src/components/greenwood/greenwood-arrival-ceremony.tsx",
    );
    const frames = read(
      "src/components/greenwood/greenwood-arrival-frames.ts",
    );
    assert.match(ui, /createPortal/);
    assert.match(ui, /document\.body\.style\.overflow/);
    assert.match(ui, /prefers-reduced-motion|reducedMotion/);
    assert.match(ui, /maxTotalMs/);
    assert.match(frames, /You have walked the Road honestly/);
    assert.match(frames, /Some roads lead to places/);
    assert.match(frames, /GREENWOOD_ARRIVAL_ASCII_MOBILE/);
    assert.doesNotMatch(ui, /localStorage/);
  });

  it("completion route requires Privy membership and is idempotent-facing", () => {
    const route = read(
      "src/app/api/greenwood/arrival-ceremony/complete/route.ts",
    );
    assert.match(route, /getVerifiedPrivyUser/);
    assert.match(route, /completeGreenwoodArrivalCeremony/);
    assert.match(route, /not_member/);
    assert.match(route, /private, no-store/);
    assert.doesNotMatch(route, /requireFennDeskAccess|requireFennAdmin/);
    assert.doesNotMatch(route, /JSON\.parse|request\.json/);
  });

  it("client completion helper posts empty body", () => {
    const client = read("src/lib/greenwood/client.ts");
    const fn = client.slice(
      client.indexOf("export async function postGreenwoodArrivalCeremonyComplete"),
    );
    assert.match(fn, /method:\s*"POST"/);
    assert.match(fn, /\/api\/greenwood\/arrival-ceremony\/complete/);
    assert.doesNotMatch(fn.slice(0, 500), /JSON\.stringify/);
    assert.doesNotMatch(fn.slice(0, 500), /^\s*body:/m);
  });

  it("CSS covers full-screen Night arrival without card chrome", () => {
    const css = read("src/app/globals.css");
    assert.match(css, /\.greenwood-arrival\s*\{/);
    assert.match(css, /z-index:\s*9999/);
    assert.match(css, /background:\s*var\(--color-night\)/);
    assert.match(css, /greenwood-arrival--reduced/);
    assert.match(css, /max-width:\s*640px/);
  });
});
