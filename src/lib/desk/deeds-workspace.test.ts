import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { parseDeskDeedsView } from "@/lib/desk/deeds-view";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

describe("parseDeskDeedsView", () => {
  it("defaults to definitions and only selects submissions explicitly", () => {
    assert.equal(parseDeskDeedsView(undefined), "definitions");
    assert.equal(parseDeskDeedsView(null), "definitions");
    assert.equal(parseDeskDeedsView(""), "definitions");
    assert.equal(parseDeskDeedsView("definitions"), "definitions");
    assert.equal(parseDeskDeedsView("unknown"), "definitions");
    assert.equal(parseDeskDeedsView("submissions"), "submissions");
    assert.equal(parseDeskDeedsView(["submissions"]), "submissions");
    assert.equal(parseDeskDeedsView(["junk", "submissions"]), "definitions");
  });
});

describe("Desk Deeds page wiring (regression: queue-only UI)", () => {
  it("page renders workspace with server searchParams, not DeskDeedsBoard alone", () => {
    const page = read("src/app/desk/deeds/page.tsx");
    assert.match(page, /DeskDeedsWorkspace/);
    assert.match(page, /searchParams/);
    assert.match(page, /parseDeskDeedsView/);
    assert.doesNotMatch(
      page,
      /export default function DeskDeedsPage\(\) \{\s*return <DeskDeedsBoard/,
    );
    assert.doesNotMatch(page, /from "@\/components\/desk\/desk-deeds-board"/);
  });

  it("workspace composes nav + definitions/submissions boards", () => {
    const workspace = read("src/components/desk/desk-deeds-workspace.tsx");
    assert.match(workspace, /DeskDeedsWorkspaceNav/);
    assert.match(workspace, /DeskDeedDefinitionsBoard/);
    assert.match(workspace, /DeskDeedsBoard/);
    assert.match(workspace, /view === "submissions"/);
    assert.doesNotMatch(workspace, /\buseSearchParams\b/);
    assert.doesNotMatch(workspace, /\bSuspense\b/);
  });

  it("workspace nav always links both query-state views", () => {
    const nav = read("src/components/desk/desk-deeds-workspace-nav.tsx");
    assert.match(nav, /\/desk\/deeds\?view=definitions/);
    assert.match(nav, /\/desk\/deeds\?view=submissions/);
    assert.match(nav, /DEFINITIONS/);
    assert.match(nav, /SUBMISSIONS/);
    assert.match(nav, /Write and release work into the world/);
    assert.match(nav, /Examine proof and decide what the world remembers/);
  });

  it("definitions board exposes WRITE A DEED and list API", () => {
    const board = read("src/components/desk/desk-deed-definitions-board.tsx");
    assert.match(board, /WRITE A DEED/);
    assert.match(board, /\/api\/desk\/deeds\?filter=/);
    assert.match(board, /NO DEEDS HAVE BEEN WRITTEN/);
    assert.match(board, /definitions\/new/);
  });

  it("submissions board keeps moderation filters and does not drop queue", () => {
    const board = read("src/components/desk/desk-deeds-board.tsx");
    assert.match(board, /pending/);
    assert.match(board, /approved/);
    assert.match(board, /rejected/);
    assert.match(board, /all/);
    assert.match(board, /oldest|newest/);
    assert.match(board, /\/api\/desk\/deeds\/submissions/);
    assert.match(board, /approve|status/); // list still status-aware
  });

  it("definition authoring pages exist on Desk routes", () => {
    assert.ok(
      existsSync(join(repo, "src/app/desk/deeds/definitions/new/page.tsx")),
    );
    assert.ok(
      existsSync(
        join(repo, "src/app/desk/deeds/definitions/[deedId]/page.tsx"),
      ),
    );
    assert.ok(
      existsSync(join(repo, "src/app/desk/deeds/definitions/page.tsx")),
    );
    const neu = read("src/app/desk/deeds/definitions/new/page.tsx");
    assert.match(neu, /DeskDeedDefinitionPanel/);
    assert.match(neu, /DeskDeedsWorkspaceNav/);
    const detail = read("src/app/desk/deeds/definitions/[deedId]/page.tsx");
    assert.match(detail, /DeskDeedDefinitionPanel/);
    assert.match(detail, /deedId/);
  });

  it("definition routes sit under desk layout gate and submission UUID guard", () => {
    const layout = read("src/app/desk/layout.tsx");
    assert.match(layout, /DeskGate/);
    const submission = read("src/app/desk/deeds/[submissionId]/page.tsx");
    assert.match(submission, /UUID_RE|notFound/);
    assert.match(submission, /DeskDeedDetailPanel/);
  });
});
