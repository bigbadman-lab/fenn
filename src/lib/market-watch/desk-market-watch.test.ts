/**
 * Market Watch 1.0C — Desk readiness pure helpers + UI/source checks.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  deriveClearingProjection,
  deriveCursorState,
  deriveEffectiveModeLine,
  deriveReadinessVerdict,
  mapMarketWatchErrorPlain,
  readinessLabel,
  shortHash,
  shortLeaseHolder,
} from "@/lib/market-watch/desk-readiness";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("Market Watch Desk readiness", () => {
  it("not_configured when incomplete", () => {
    assert.equal(
      deriveReadinessVerdict({
        configComplete: false,
        workerMode: "live",
        configEnabled: true,
        heartbeatStatus: "current",
        lastErrorCode: null,
        cursorLagBlocks: 0,
        confirmationDepth: 5,
        cursorExists: true,
        lastProcessedBlock: 1,
      }),
      "not_configured",
    );
    assert.equal(readinessLabel("not_configured"), "NOT CONFIGURED");
  });

  it("disabled when mode disabled and configured", () => {
    assert.equal(
      deriveReadinessVerdict({
        configComplete: true,
        workerMode: "disabled",
        configEnabled: false,
        heartbeatStatus: "absent",
        lastErrorCode: null,
        cursorLagBlocks: null,
        confirmationDepth: 5,
        cursorExists: false,
        lastProcessedBlock: null,
      }),
      "disabled",
    );
  });

  it("stalled on reorg or stale heartbeat while active", () => {
    assert.equal(
      deriveReadinessVerdict({
        configComplete: true,
        workerMode: "dry_run",
        configEnabled: true,
        heartbeatStatus: "current",
        lastErrorCode: "mw_cursor_reorg",
        cursorLagBlocks: 2,
        confirmationDepth: 5,
        cursorExists: true,
        lastProcessedBlock: 10,
      }),
      "stalled",
    );
    assert.equal(
      deriveReadinessVerdict({
        configComplete: true,
        workerMode: "dry_run",
        configEnabled: true,
        heartbeatStatus: "stale",
        lastErrorCode: null,
        cursorLagBlocks: 2,
        confirmationDepth: 5,
        cursorExists: true,
        lastProcessedBlock: 10,
      }),
      "stalled",
    );
  });

  it("degraded on processing lag or soft error", () => {
    assert.equal(
      deriveReadinessVerdict({
        configComplete: true,
        workerMode: "dry_run",
        configEnabled: true,
        heartbeatStatus: "current",
        lastErrorCode: null,
        cursorLagBlocks: 80,
        confirmationDepth: 5,
        cursorExists: true,
        lastProcessedBlock: 10,
      }),
      "degraded",
    );
    assert.equal(
      deriveReadinessVerdict({
        configComplete: true,
        workerMode: "live",
        configEnabled: false,
        heartbeatStatus: "current",
        lastErrorCode: null,
        cursorLagBlocks: 2,
        confirmationDepth: 5,
        cursorExists: true,
        lastProcessedBlock: 10,
      }),
      "degraded",
    );
  });

  it("dry_run and live healthy paths", () => {
    assert.equal(
      deriveReadinessVerdict({
        configComplete: true,
        workerMode: "dry_run",
        configEnabled: true,
        heartbeatStatus: "current",
        lastErrorCode: null,
        cursorLagBlocks: 3,
        confirmationDepth: 5,
        cursorExists: true,
        lastProcessedBlock: 100,
      }),
      "dry_run",
    );
    assert.equal(
      deriveReadinessVerdict({
        configComplete: true,
        workerMode: "live",
        configEnabled: true,
        heartbeatStatus: "current",
        lastErrorCode: null,
        cursorLagBlocks: 3,
        confirmationDepth: 5,
        cursorExists: true,
        lastProcessedBlock: 100,
      }),
      "live",
    );
  });
});

describe("Market Watch Desk projection and mode lines", () => {
  it("maps projection from mode + enabled", () => {
    assert.equal(
      deriveClearingProjection({
        workerMode: "disabled",
        configEnabled: true,
      }).status,
      "off_disabled",
    );
    assert.equal(
      deriveClearingProjection({
        workerMode: "dry_run",
        configEnabled: true,
      }).status,
      "off_dry_run",
    );
    assert.match(
      deriveClearingProjection({
        workerMode: "dry_run",
        configEnabled: true,
      }).line,
      /DRY RUN NEVER PUBLISHES/,
    );
    assert.equal(
      deriveClearingProjection({
        workerMode: "live",
        configEnabled: false,
      }).status,
      "off_config",
    );
    assert.equal(
      deriveClearingProjection({
        workerMode: "live",
        configEnabled: true,
      }).status,
      "on",
    );
  });

  it("explains effective mode distinctly", () => {
    assert.match(
      deriveEffectiveModeLine({
        workerMode: "disabled",
        configEnabled: false,
      }),
      /No events can be published/i,
    );
    assert.match(
      deriveEffectiveModeLine({
        workerMode: "dry_run",
        configEnabled: true,
      }),
      /not published/i,
    );
    assert.match(
      deriveEffectiveModeLine({
        workerMode: "live",
        configEnabled: true,
      }),
      /Clearing/,
    );
  });
});

describe("Market Watch Desk cursor state and errors", () => {
  it("distinguishes not initialised vs confirming vs lag", () => {
    assert.equal(
      deriveCursorState({
        cursorExists: false,
        launchBlock: 100,
        lastProcessed: null,
        latestChain: 200,
        confirmationDepth: 5,
        lag: null,
        stalled: false,
      }).state,
      "not_initialised",
    );
    assert.equal(
      deriveCursorState({
        cursorExists: true,
        launchBlock: 100,
        lastProcessed: 150,
        latestChain: 155,
        confirmationDepth: 5,
        lag: 4,
        stalled: false,
      }).state,
      "confirming",
    );
    assert.equal(
      deriveCursorState({
        cursorExists: true,
        launchBlock: 100,
        lastProcessed: 100,
        latestChain: 200,
        confirmationDepth: 5,
        lag: 80,
        stalled: false,
      }).state,
      "processing_lag",
    );
  });

  it("maps error codes to plain language", () => {
    assert.match(
      mapMarketWatchErrorPlain("mw_rpc_failed") ?? "",
      /ROBINHOOD CHAIN/,
    );
    assert.match(
      mapMarketWatchErrorPlain("mw_cursor_reorg") ?? "",
      /CURSOR BLOCK HASH/,
    );
    assert.match(
      mapMarketWatchErrorPlain("token_address_mismatch_official") ?? "",
      /OFFICIAL \$VELL/,
    );
  });

  it("shortens hashes and lease holders safely", () => {
    const h = "0x" + "ab".repeat(32);
    assert.ok(shortHash(h)?.includes("…"));
    assert.ok(
      shortLeaseHolder("abcdef12-3456-7890-abcd-ef1234567890:42")?.startsWith(
        "abcdef12",
      ),
    );
  });
});

describe("Market Watch Desk sources and security", () => {
  it("exposes Desk route, nav, and gated API", () => {
    const page = read("src/app/desk/market-watch/page.tsx");
    assert.match(page, /MARKET WATCH|DeskMarketWatchPanel/);
    const gate = read("src/components/desk/desk-gate.tsx");
    assert.match(gate, /\/desk\/market-watch/);
    assert.match(gate, /MARKET WATCH/);
    const route = read("src/app/api/desk/market-watch/route.ts");
    assert.match(route, /requireFennDeskAccess/);
    assert.match(route, /getMarketWatchDeskSnapshot/);
    assert.doesNotMatch(route, /POST|PATCH|put /i);
  });

  it("DTO/ops never expose secrets or buyer fields", () => {
    const ops = read("src/lib/market-watch/desk-ops.ts");
    assert.doesNotMatch(
      ops,
      /SERVICE_ROLE|ROBINHOOD_CHAIN_RPC_URL|cookie|buyer|tx_from|raw_log/,
    );
    assert.doesNotMatch(ops, /whale|moon|buy signal|bullish/i);
    const types = read("src/lib/market-watch/desk-types.ts");
    assert.doesNotMatch(types, /rpcUrl|serviceRole|SUPABASE_SERVICE/);
  });

  it("mode is environment-guided with no live Desk activation", () => {
    const panel = read("src/components/desk/desk-market-watch-panel.tsx");
    assert.match(panel, /LIVE ACTIVATION IS NOT YET AVAILABLE FROM DESK|liveActivationNote/);
    assert.doesNotMatch(panel, /setMode|mode=live|enableLive|POST.*mode/);
    assert.match(panel, /WORKER MODE|CONFIG ENABLED/);
    assert.match(panel, /POLL_MS|MARKET_WATCH_DESK_POLL_MS|12000/);
    assert.match(panel, /visibilitychange|visibilityState/);
    assert.match(panel, /aria-label|aria-pressed|role="status"/);
    assert.doesNotMatch(panel, /createClient|supabase|getLogs|viem/);
  });

  it("worker and Clearing projection paths remain untouched by Desk UI", () => {
    const worker = read("scripts/market-watch-worker.ts");
    assert.doesNotMatch(worker, /desk-market-watch|DeskMarketWatch/);
    const feed = read("src/lib/clearing/feed.ts");
    assert.match(feed, /market_watch_events/);
    assert.doesNotMatch(feed, /desk-ops|DeskMarketWatch/);
  });
});
