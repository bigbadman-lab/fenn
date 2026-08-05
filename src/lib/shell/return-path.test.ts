import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { shouldShowShellReturn } from "@/lib/shell/return-path";

const repo = join(process.cwd());

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

describe("shouldShowShellReturn", () => {
  it("never shows on homepage spellings (including Vercel ISR /index)", () => {
    assert.equal(shouldShowShellReturn(null), false);
    assert.equal(shouldShowShellReturn(undefined), false);
    assert.equal(shouldShowShellReturn(""), false);
    assert.equal(shouldShowShellReturn("/"), false);
    assert.equal(shouldShowShellReturn("/index"), false);
    assert.equal(shouldShowShellReturn("/index/"), false);
  });

  it("shows on inner world routes", () => {
    assert.equal(shouldShowShellReturn("/camp"), true);
    assert.equal(shouldShowShellReturn("/greenwood"), true);
    assert.equal(shouldShowShellReturn("/outlaw"), true);
    assert.equal(shouldShowShellReturn("/desk"), true);
    assert.equal(shouldShowShellReturn("/wall/"), true);
  });
});

describe("ShellReturn wiring", () => {
  it("uses path helper and does not treat only exact / as home", () => {
    const src = read("src/components/shell/shell-return.tsx");
    assert.match(src, /shouldShowShellReturn/);
    assert.match(src, /from "@\/lib\/shell\/return-path"/);
    assert.doesNotMatch(src, /pathname === ["']\/["']/);
  });

  it("remains mounted from ApplicationShell for all routes", () => {
    const shell = read("src/components/shell/application-shell.tsx");
    assert.match(shell, /ShellReturn/);
  });
});
