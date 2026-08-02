import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

describe("LG5.3 Desk Fire", () => {
  it("Fire API requires Desk access and excludes wallets", () => {
    const route = read("src/app/api/desk/fire/route.ts");
    const lib = read("src/lib/desk/fire.ts");
    const types = read("src/lib/desk/fire-types.ts");
    assert.match(route, /requireFennDeskAccess/);
    assert.match(route, /getDeskFireSnapshot/);
    assert.doesNotMatch(route, /requireFennAdmin|\/api\/admin/);
    assert.match(lib, /isFirePresenceActive/);
    assert.match(types, /profileId/);
    assert.doesNotMatch(types, /walletAddress|privyUserId|email/i);
    assert.doesNotMatch(lib, /wallet_address/);
  });

  it("Fire UI has no wallet and no force-leave", () => {
    const ui = read("src/components/desk/desk-fire-panel.tsx");
    assert.match(ui, /WHO IS WAITING TO BE CALLED/);
    assert.match(ui, /The Fire is quiet/);
    assert.match(ui, /WAITING BY THE FIRE/);
    assert.match(ui, /MARKS STILL WARM/);
    assert.doesNotMatch(ui, /force leave|walletAddress|COPY WALLET/i);
    assert.doesNotMatch(ui, /\/api\/admin/);
  });
});

describe("LG5.3 Desk Gatherings", () => {
  it("Desk Gathering APIs require Desk access and reuse domain ops", () => {
    const routes = [
      "src/app/api/desk/gatherings/route.ts",
      "src/app/api/desk/gatherings/[id]/route.ts",
      "src/app/api/desk/gatherings/[id]/publish/route.ts",
      "src/app/api/desk/gatherings/[id]/cancel/route.ts",
      "src/app/api/desk/gatherings/[id]/close/route.ts",
      "src/app/api/desk/gatherings/[id]/hands/route.ts",
    ];
    for (const rel of routes) {
      const source = read(rel);
      assert.match(source, /requireFennDeskAccess/);
      assert.doesNotMatch(source, /requireFennAdmin/);
      assert.doesNotMatch(source, /\/api\/admin/);
    }
    const lib = read("src/lib/desk/gatherings.ts");
    assert.match(lib, /adminListGatherings/);
    assert.match(lib, /adminCreateGatheringDraft/);
    assert.match(lib, /adminPublishGathering/);
    assert.match(lib, /adminCancelGathering/);
    assert.match(lib, /adminCloseGathering/);
    assert.match(lib, /greenwood\/gatherings\/admin-ops/);
  });

  it("Desk Gathering helpers preserve audit action names via domain ops", () => {
    const adminOps = read("src/lib/greenwood/gatherings/admin-ops.ts");
    assert.match(adminOps, /greenwood\.gathering\.create/);
    assert.match(adminOps, /greenwood\.gathering\.update/);
    assert.match(adminOps, /greenwood\.gathering\.publish/);
    assert.match(adminOps, /greenwood\.gathering\.cancel/);
    assert.match(adminOps, /greenwood\.gathering\.close/);
  });

  it("hand DTO excludes wallets and includes Register profile links", () => {
    const types = read("src/lib/desk/gatherings-types.ts");
    const ui = read("src/components/desk/desk-gatherings-board.tsx");
    assert.match(types, /profileId/);
    assert.doesNotMatch(types, /wallet|privy|createdByActorId/i);
    assert.match(ui, /PUBLISH THIS GATHERING/);
    assert.match(ui, /Hands still raised when the Gathering closes/);
    assert.match(ui, /CREATE HOLLOW CAMPAIGN/);
    assert.doesNotMatch(ui, /\/api\/admin|COPY WALLET|walletAddress/);
  });

  it("Admin Gathering routes remain independently gated", () => {
    const adminList = read("src/app/api/admin/greenwood/gatherings/route.ts");
    const adminPage = read("src/app/admin/greenwood/gatherings/page.tsx");
    assert.match(adminList, /requireFennAdmin/);
    assert.doesNotMatch(adminList, /requireFennDeskAccess|FENN_DESK/);
    assert.match(adminPage, /AdminGatheringsBoard/);
  });

  it("overview links Fire and Gatherings routes", () => {
    const overview = read("src/lib/desk/overview.ts");
    assert.match(overview, /href: "\/desk\/fire"/);
    assert.match(overview, /href: "\/desk\/gatherings"/);
    assert.match(overview, /href: `\/desk\/gatherings\/\$\{item\.id\}`/);
  });

  it("no dual allowlist guard and no Hollow mutation in Desk gatherings", () => {
    const lib = read("src/lib/desk/gatherings.ts");
    assert.doesNotMatch(lib, /FENN_ADMIN_WALLETS|GREENWOOD_ACCESS_WALLETS/);
    assert.doesNotMatch(lib, /adminCreateCampaign|make-available|record-transaction/);
    assert.doesNotMatch(
      read("src/components/desk/desk-gate.tsx"),
      /either allowlist|dual/i,
    );
  });
});
