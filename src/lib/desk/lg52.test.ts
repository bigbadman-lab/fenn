import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DESK_REGISTER_DEFAULT_LIMIT,
  DESK_REGISTER_MAX_LIMIT,
  DeskRegisterQueryError,
  escapeIlikePattern,
  parseDeskRegisterQuery,
} from "@/lib/desk/register-query";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

describe("Desk overview architecture", () => {
  it("overview API requires Desk access and uses no-store", () => {
    const route = read("src/app/api/desk/overview/route.ts");
    assert.match(route, /requireFennDeskAccess/);
    assert.match(route, /getDeskOverview/);
    assert.match(route, /force-dynamic/);
    assert.doesNotMatch(route, /requireFennAdmin|FENN_ADMIN_WALLETS/);
    assert.doesNotMatch(route, /\/api\/admin/);
  });

  it("overview DTO and builder omit wallets and invent no health score", () => {
    const types = read("src/lib/desk/overview-types.ts");
    const overview = read("src/lib/desk/overview.ts");
    assert.doesNotMatch(types, /walletAddress|0x[a-fA-F0-9]{40}/);
    assert.doesNotMatch(overview, /all systems are healthy/i);
    assert.match(overview, /DESK_GATHERING_ENDING_SOON_MS/);
    assert.match(overview, /allSourcesOk/);
    assert.match(overview, /availability: "unavailable"/);
    assert.match(overview, /30 \* 60 \* 1000/);
  });

  it("overview UI has no wallet and uses attention copy", () => {
    const ui = read("src/components/desk/desk-overview-panel.tsx");
    assert.match(ui, /WHAT NEEDS MY ATTENTION/);
    assert.doesNotMatch(ui, /walletAddress|0x[a-fA-F0-9]{40}/);
    assert.doesNotMatch(ui, /\/api\/admin/);
  });
});

describe("Desk Register query validation", () => {
  it("defaults and bounds pagination", () => {
    const q = parseDeskRegisterQuery({});
    assert.equal(q.page, 1);
    assert.equal(q.limit, DESK_REGISTER_DEFAULT_LIMIT);
    assert.equal(DESK_REGISTER_MAX_LIMIT, 50);
  });

  it("enforces maximum limit and rejects invalid page", () => {
    assert.throws(
      () => parseDeskRegisterQuery({ limit: "51" }),
      DeskRegisterQueryError,
    );
    assert.throws(
      () => parseDeskRegisterQuery({ page: "0" }),
      DeskRegisterQueryError,
    );
    assert.throws(
      () => parseDeskRegisterQuery({ page: "abc" }),
      DeskRegisterQueryError,
    );
  });

  it("rejects unsafe search characters and overlong queries", () => {
    assert.throws(
      () => parseDeskRegisterQuery({ q: "foo;drop" }),
      DeskRegisterQueryError,
    );
    assert.throws(
      () => parseDeskRegisterQuery({ q: "a".repeat(121) }),
      DeskRegisterQueryError,
    );
  });

  it("accepts filters and escapes ilike patterns", () => {
    const q = parseDeskRegisterQuery({
      q: "Ash",
      greenwood: "member",
      presence: "at_fire",
      pendingDeeds: "pending",
      page: "2",
      limit: "25",
    });
    assert.equal(q.greenwood, "member");
    assert.equal(q.presence, "at_fire");
    assert.equal(q.pendingDeeds, "pending");
    assert.equal(q.page, 2);
    assert.equal(escapeIlikePattern("100%_"), "100\\%\\_");
  });
});

describe("Desk Register API and privacy", () => {
  it("list and detail APIs require Desk access independently", () => {
    const list = read("src/app/api/desk/register/route.ts");
    const detail = read("src/app/api/desk/register/[profileId]/route.ts");
    assert.match(list, /requireFennDeskAccess/);
    assert.match(detail, /requireFennDeskAccess/);
    assert.match(list, /parseDeskRegisterQuery/);
    assert.match(detail, /getDeskRegisterMember/);
    assert.doesNotMatch(list, /requireFennAdmin|\/api\/admin/);
    assert.doesNotMatch(detail, /requireFennAdmin|\/api\/admin/);
  });

  it("register DTO includes authoritative wallet and excludes secrets", () => {
    const types = read("src/lib/desk/register-types.ts");
    const lib = read("src/lib/desk/register.ts");
    assert.match(types, /walletAddress/);
    assert.doesNotMatch(types, /privy|email|accessToken/i);
    assert.match(lib, /profiles\.wallet_address|wallet_address/);
    assert.match(lib, /outlaw_number.*ascending|order\("outlaw_number"/);
    assert.doesNotMatch(lib, /camp_messages/);
    assert.doesNotMatch(lib, /\bCSV\b|bulk.?export|downloadAll/i);
  });

  it("register UI supports copy wallet without bulk export", () => {
    const board = read("src/components/desk/desk-register-board.tsx");
    const member = read("src/components/desk/desk-register-member-panel.tsx");
    assert.match(board, /COPY WALLET/);
    assert.match(member, /COPY WALLET/);
    assert.doesNotMatch(board, /\bCSV\b|bulk copy|export all|select all/i);
    assert.doesNotMatch(member, /camp_messages|transcript/i);
    assert.match(board, /\/desk\/register\/\$\{member\.profileId\}/);
  });

  it("desk gate links only completed surfaces", () => {
    const gate = read("src/components/desk/desk-gate.tsx");
    assert.match(gate, /href="\/desk"/);
    assert.match(gate, /href="\/desk\/register"/);
    assert.match(gate, /href="\/desk\/fire"/);
    assert.match(gate, /href="\/desk\/gatherings"/);
    assert.match(gate, /href="\/desk\/hollow"/);
    assert.match(gate, /href="\/desk\/deeds"/);
    assert.match(gate, /href="\/desk\/treasury"/);
    assert.match(gate, /href="\/desk\/book"/);
    assert.match(gate, /href="\/desk\/agent"/);
    assert.doesNotMatch(gate, /\/desk\/memory|\/desk\/camp|\/desk\/wall|\/desk\/audit/);
    assert.doesNotMatch(gate, /\/admin/);
  });

  it("no public map or nav discovery of Register", () => {
    assert.doesNotMatch(read("src/content/home-world-map.ts"), /\/desk/);
    assert.doesNotMatch(read("src/lib/home/fenn-map-path.ts"), /\/desk/);
  });

  it("LG5.1 quiet deny and admin separation remain", () => {
    const gate = read("src/components/desk/desk-gate.tsx");
    assert.match(gate, /There is nothing here\./);
    assert.doesNotMatch(gate, /Connect Wallet|Access denied/i);
    assert.match(
      read("src/lib/admin/auth.ts"),
      /export async function requireFennAdmin/,
    );
    assert.doesNotMatch(
      read("src/lib/admin/auth.ts"),
      /FENN_DESK_WALLETS/,
    );
  });

  it("no Desk mutation routes introduced", () => {
    assert.doesNotMatch(
      read("src/app/api/desk/overview/route.ts"),
      /export async function POST|PATCH|DELETE/,
    );
    assert.doesNotMatch(
      read("src/app/api/desk/register/route.ts"),
      /export async function POST|PATCH|DELETE/,
    );
    assert.doesNotMatch(
      read("src/app/api/desk/register/[profileId]/route.ts"),
      /export async function POST|PATCH|DELETE/,
    );
  });

  it("explorer address helper is chain-mapped to Blockscout", () => {
    const explorer = read("src/lib/greenwood/hollow/explorer.ts");
    assert.match(explorer, /robinhoodAddressExplorerUrl/);
    assert.match(explorer, /ROBINHOOD_CHAIN_EXPLORER_BASE/);
    assert.match(explorer, /robinhoodchain\.blockscout\.com/);
    assert.match(explorer, /\/tx\//);
    assert.match(explorer, /\/address\//);
    assert.doesNotMatch(explorer, /explorer\.robinhood\.com/);
  });
});
