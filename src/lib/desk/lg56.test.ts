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

describe("LG5.6 Desk authority inventory", () => {
  it("every Desk API route independently requires Desk access", () => {
    const routes = walkTs(join(repo, "src/app/api/desk"));
    assert.ok(routes.length >= 30, `expected Desk routes, got ${routes.length}`);
    for (const abs of routes) {
      const source = readFileSync(abs, "utf8");
      assert.match(source, /requireFennDeskAccess/, abs);
      assert.doesNotMatch(source, /requireFennAdmin/, abs);
      assert.doesNotMatch(source, /\/api\/admin/, abs);
      assert.doesNotMatch(
        source,
        /FENN_ADMIN_WALLETS|GREENWOOD_ACCESS_WALLETS/,
        abs,
      );
    }
  });

  it("Desk JSON responses are private no-store", () => {
    const http = read("src/lib/desk/http.ts");
    assert.match(http, /private, no-store/);
    assert.match(http, /export function deskJson/);
    const session = read("src/app/api/desk/session/route.ts");
    assert.match(session, /private, no-store|no-store/);
  });

  it("DeskGate clears protected state with generation/abort safety", () => {
    const gate = read("src/components/desk/desk-gate.tsx");
    assert.match(gate, /sessionGeneration/);
    assert.match(gate, /generation !== sessionGeneration\.current/);
    assert.match(gate, /!authenticated/);
    assert.match(gate, /There is nothing here\./);
    assert.doesNotMatch(gate, /Access denied|wrong wallet|allowlist required/i);
  });
});

describe("LG5.6 privacy and secrets", () => {
  it("Desk DTOs and agent health do not expose tokens or secrets", () => {
    const agent = read("src/lib/desk/agent.ts");
    const treasury = read("src/lib/desk/treasury.ts");
    const book = read("src/lib/desk/book.ts");
    const registerTypes = read("src/lib/desk/register-types.ts");
    assert.doesNotMatch(agent, /access_token|refresh_token|accessToken/);
    assert.doesNotMatch(treasury, /ROBINHOOD_CHAIN_RPC_URL\}|privateKey/);
    assert.doesNotMatch(book, /CRON_SECRET|OPENAI_API_KEY|prompt/);
    assert.doesNotMatch(registerTypes, /privyUserId|email/i);
    assert.doesNotMatch(
      read("src/lib/desk/fire-types.ts"),
      /walletAddress|privyUserId|privy_user/i,
    );
    assert.doesNotMatch(
      read("src/lib/desk/gatherings-types.ts"),
      /walletAddress|privyUserId|privy_user/i,
    );
  });

  it("no signing or private-key paths in Desk hollow/treasury/agent UI", () => {
    for (const rel of [
      "src/components/desk/desk-hollow-detail-panel.tsx",
      "src/components/desk/desk-treasury-panel.tsx",
      "src/components/desk/desk-agent-panel.tsx",
    ]) {
      const ui = read(rel);
      assert.doesNotMatch(ui, /privateKey|walletClient|signTransaction|eth_send/i);
      assert.doesNotMatch(ui, /run pipeline|run-now|executePending/i);
    }
  });
});

describe("LG5.6 confirmation consistency", () => {
  it("dangerous Desk actions use explicit confirmation phrases", () => {
    const operate = read("src/components/desk/desk-gathering-operate.tsx");
    assert.match(operate, /End this Gathering now/);
    assert.match(operate, /Cancel this Gathering/);
    assert.match(operate, /confirm end|confirm cancel|confirm close/);
    assert.match(
      read("src/components/desk/desk-gathering-detail-panel.tsx"),
      /DeskGatheringOperate/,
    );
    assert.match(
      read("src/components/desk/desk-book-panel.tsx"),
      /Generate with VELL/,
    );
    assert.doesNotMatch(
      read("src/components/desk/desk-book-panel.tsx"),
      /confirm write/i,
    );
    assert.match(
      read("src/components/desk/desk-agent-panel.tsx"),
      /BIND ASKFENN OAUTH/,
    );
    assert.match(
      read("src/components/desk/desk-hollow-detail-panel.tsx"),
      /RESOLVE THIS CAMPAIGN/,
    );
    assert.match(
      read("src/components/desk/desk-hollow-detail-panel.tsx"),
      /MARK AS CONFIRMED/,
    );
    assert.match(
      read("src/components/desk/desk-hollow-detail-panel.tsx"),
      /confirm mark confirmed/,
    );
    assert.match(
      read("src/components/desk/desk-deed-detail-panel.tsx"),
      /APPROVE THIS DEED/,
    );
    assert.match(
      read("src/components/desk/desk-speaks-panel.tsx"),
      /PUBLISH THIS MESSAGE/,
    );
    assert.match(
      read("src/components/desk/desk-speaks-panel.tsx"),
      /Turn into FENN Speak/,
    );
  });
});

describe("LG5.6 Admin compatibility", () => {
  it("Admin pages and APIs remain independently gated", () => {
    for (const rel of [
      "src/app/api/admin/deeds/submissions/route.ts",
      "src/app/api/admin/greenwood/gatherings/route.ts",
      "src/app/api/admin/greenwood/rewards/route.ts",
      "src/app/api/admin/x/oauth/start/route.ts",
    ]) {
      const source = read(rel);
      assert.match(source, /requireFennAdmin/);
      assert.doesNotMatch(source, /requireFennDeskAccess|FENN_DESK/);
    }
  });

  it("Desk and Admin OAuth start paths are both documented", () => {
    const env = read(".env.example");
    const contract = read("src/lib/x/write-auth-contract.ts");
    assert.match(env, /\/api\/desk\/agent\/oauth\/start/);
    assert.match(env, /\/api\/admin\/x\/oauth\/start/);
    assert.match(contract, /oauthStartPath:\s*"\/api\/admin\/x\/oauth\/start"/);
    assert.match(
      contract,
      /deskOauthStartPath:\s*"\/api\/desk\/agent\/oauth\/start"/,
    );
  });

  it("correct-transaction remains Desk-exposed domain reuse without Admin feature expansion", () => {
    assert.match(
      read(
        "src/app/api/desk/hollow/rewards/[rewardId]/correct-transaction/route.ts",
      ),
      /deskCorrectTransaction|adminCorrectTransaction|requireFennDeskAccess/,
    );
    // Intentionally no Admin HTTP expansion in LG5.6.
    const adminHollow = walkTs(
      join(repo, "src/app/api/admin/greenwood/hollow"),
    ).map((p) => p.replace(`${repo}/`, ""));
    assert.ok(
      !adminHollow.some((p) => p.includes("correct-transaction")),
      "Admin must not gain new correct-transaction route in this stage",
    );
  });
});

describe("LG5.6 discovery", () => {
  it("Desk is not publicly linked and pages are noindex", () => {
    assert.doesNotMatch(read("src/content/home-world-map.ts"), /\/desk/);
    assert.doesNotMatch(read("src/lib/home/fenn-map-path.ts"), /\/desk/);
    const layout = read("src/app/desk/layout.tsx");
    assert.match(layout, /index:\s*false|robots|buildPrivateMetadata/);
  });
});
