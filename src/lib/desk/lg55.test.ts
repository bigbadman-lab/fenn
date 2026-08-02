import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("LG5.5 Desk Deeds", () => {
  it("Desk Deeds APIs require Desk access and reuse moderation authority", () => {
    const routes = walkTs(join(repo, "src/app/api/desk/deeds"));
    assert.ok(routes.length >= 4);
    for (const abs of routes) {
      const source = readFileSync(abs, "utf8");
      assert.match(source, /requireFennDeskAccess/);
      assert.doesNotMatch(source, /requireFennAdmin|\/api\/admin/);
    }
    const lib = read("src/lib/desk/deeds.ts");
    assert.match(lib, /approveDeedSubmission/);
    assert.match(lib, /rejectDeedSubmission/);
    assert.match(lib, /signSubmissionEvidenceImage/);
    assert.match(lib, /identity\.actorId/);
    assert.doesNotMatch(lib, /FENN_ADMIN_WALLETS|dual allowlist/i);
  });

  it("approve/reject use server-resolved actor and confirmation UI", () => {
    const approve = read(
      "src/app/api/desk/deeds/submissions/[id]/approve/route.ts",
    );
    const reject = read(
      "src/app/api/desk/deeds/submissions/[id]/reject/route.ts",
    );
    const detail = read("src/components/desk/desk-deed-detail-panel.tsx");
    assert.match(approve, /identity/);
    assert.match(reject, /identity/);
    assert.doesNotMatch(approve, /body\.actorId|body\.admin/);
    assert.match(detail, /APPROVE THIS DEED/);
    assert.match(detail, /REJECT THIS DEED/);
    assert.match(detail, /\/api\/desk\/deeds\/submissions/);
    assert.doesNotMatch(detail, /\/api\/admin/);
  });

  it("Admin Deeds remain independently gated", () => {
    const admin = read("src/app/api/admin/deeds/submissions/route.ts");
    assert.match(admin, /requireFennAdmin/);
    assert.doesNotMatch(admin, /requireFennDeskAccess|FENN_DESK/);
  });
});

describe("LG5.5 Desk Treasury", () => {
  it("Treasury route is Desk-only read and reuses public snapshot", () => {
    const route = read("src/app/api/desk/treasury/route.ts");
    const lib = read("src/lib/desk/treasury.ts");
    const ui = read("src/components/desk/desk-treasury-panel.tsx");
    assert.match(route, /requireFennDeskAccess/);
    assert.match(route, /getDeskTreasurySnapshot/);
    assert.doesNotMatch(route, /requireFennAdmin|POST|PATCH|DELETE/);
    assert.match(lib, /getPublicTreasurySnapshot/);
    assert.doesNotMatch(lib, /ROBINHOOD_CHAIN_RPC_URL\}|privateKey|sign/i);
    assert.match(ui, /REFRESH TREASURY/);
    assert.match(ui, /Read-only\. No transfers\./);
    assert.doesNotMatch(ui, /private key|walletClient|signTransaction/i);
  });
});

describe("LG5.5 Desk Book", () => {
  it("Book health is Desk-only and generation is fill-if-missing", () => {
    const route = read("src/app/api/desk/book/route.ts");
    const generate = read("src/app/api/desk/book/generate/route.ts");
    const lib = read("src/lib/desk/book.ts");
    assert.match(route, /requireFennDeskAccess/);
    assert.match(generate, /requireFennDeskAccess/);
    assert.match(generate, /confirm:true|confirm: z\.literal\(true\)/);
    assert.match(lib, /runDailyChronicle/);
    assert.match(lib, /Never overwrites|already_exists|fill-if-missing/i);
    assert.doesNotMatch(lib, /CRON_SECRET|OPENAI_API_KEY|prompt/);
    assert.doesNotMatch(generate, /CRON_SECRET|\/api\/cron/);
  });

  it("cron route remains cron-secret gated", () => {
    const cron = read("src/app/api/cron/chronicle-daily/route.ts");
    assert.match(cron, /CRON_SECRET/);
    assert.doesNotMatch(cron, /requireFennDeskAccess/);
  });
});

describe("LG5.5 Desk Agent", () => {
  it("Agent health excludes tokens and OAuth start is Desk-gated", () => {
    const route = read("src/app/api/desk/agent/route.ts");
    const oauth = read("src/app/api/desk/agent/oauth/start/route.ts");
    const lib = read("src/lib/desk/agent.ts");
    const ui = read("src/components/desk/desk-agent-panel.tsx");
    assert.match(route, /requireFennDeskAccess/);
    assert.match(oauth, /requireFennDeskAccess/);
    assert.match(oauth, /createPkceSession|buildXAuthorizationUrl/);
    assert.doesNotMatch(oauth, /requireFennAdmin/);
    assert.doesNotMatch(lib, /access_token|refresh_token|accessToken/);
    assert.doesNotMatch(ui, /run pipeline|post reply|retry effect/i);
    assert.doesNotMatch(route, /runXAgentPipeline|run-now/);
  });

  it("Admin OAuth start remains Admin-only", () => {
    const admin = read("src/app/api/admin/x/oauth/start/route.ts");
    assert.match(admin, /requireFennAdmin/);
    assert.doesNotMatch(admin, /requireFennDeskAccess/);
  });
});

describe("LG5.5 Overview and nav", () => {
  it("overview links Deeds Treasury Book Agent", () => {
    const overview = read("src/lib/desk/overview.ts");
    assert.match(overview, /\/desk\/deeds/);
    assert.match(overview, /\/desk\/treasury/);
    assert.match(overview, /\/desk\/book/);
    assert.match(overview, /\/desk\/agent/);
    assert.doesNotMatch(overview, /walletAddress|access_token|CRON_SECRET/);
  });

  it("nav includes wider-world surfaces and excludes unfinished ones", () => {
    const gate = read("src/components/desk/desk-gate.tsx");
    assert.match(gate, /\/desk\/deeds/);
    assert.match(gate, /\/desk\/treasury/);
    assert.match(gate, /\/desk\/book/);
    assert.match(gate, /\/desk\/agent/);
    assert.doesNotMatch(gate, /\/desk\/memory|\/desk\/camp|\/desk\/audit/);
  });
});
