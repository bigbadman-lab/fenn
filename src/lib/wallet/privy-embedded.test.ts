import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  matchesPrivyEmbeddedConnectedWallet,
  resolveProfileWalletPresentation,
} from "@/lib/wallet/privy-embedded";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

const EMBEDDED = "11111111111111111111111111111111";
const EXTERNAL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const OTHER = "7EcDhSYGxXyoWPo9a6p9q7q7q7q7q7q7q7q7q7q7q7q7";

function embeddedWallet(address: string, imported = false) {
  return {
    address,
    walletClientType: "privy" as const,
    connectorType: "embedded" as const,
    imported,
  };
}

function metamaskWallet(address: string) {
  return {
    address,
    walletClientType: "phantom" as const,
    connectorType: "injected" as const,
    imported: false,
  };
}

describe("matchesPrivyEmbeddedConnectedWallet", () => {
  it("accepts privy + embedded + non-imported", () => {
    assert.equal(
      matchesPrivyEmbeddedConnectedWallet(embeddedWallet(EMBEDDED)),
      true,
    );
  });

  it("rejects imported embedded, external, or incomplete metadata", () => {
    assert.equal(
      matchesPrivyEmbeddedConnectedWallet(embeddedWallet(EMBEDDED, true)),
      false,
    );
    assert.equal(
      matchesPrivyEmbeddedConnectedWallet(metamaskWallet(EXTERNAL)),
      false,
    );
    assert.equal(
      matchesPrivyEmbeddedConnectedWallet({
        address: EMBEDDED,
        walletClientType: "privy",
      }),
      false,
    );
    assert.equal(
      matchesPrivyEmbeddedConnectedWallet({
        address: EMBEDDED,
        walletClientType: "privy",
        connectorType: "injected",
      }),
      false,
    );
  });
});

describe("resolveProfileWalletPresentation", () => {
  it("exports only when official embedded helper address matches profile", () => {
    const result = resolveProfileWalletPresentation({
      profileAddress: EMBEDDED.toUpperCase(),
      embeddedConnectedAddress: EMBEDDED,
      connectedWallets: [embeddedWallet(EMBEDDED), metamaskWallet(EXTERNAL)],
      walletsReady: true,
    });
    assert.equal(result.kind, "embedded");
    assert.equal(result.canExport, true);
    assert.equal(result.exportAddress, EMBEDDED);
    assert.equal(result.address, EMBEDDED);
  });

  it("never exports a different linked wallet than the profile", () => {
    const result = resolveProfileWalletPresentation({
      profileAddress: EXTERNAL,
      embeddedConnectedAddress: EMBEDDED,
      connectedWallets: [embeddedWallet(EMBEDDED), metamaskWallet(EXTERNAL)],
      walletsReady: true,
    });
    assert.equal(result.kind, "external");
    assert.equal(result.canExport, false);
    assert.equal(result.exportAddress, null);
    assert.equal(result.address, EXTERNAL);
  });

  it("hides export for pure external profile wallet", () => {
    const result = resolveProfileWalletPresentation({
      profileAddress: EXTERNAL,
      embeddedConnectedAddress: null,
      connectedWallets: [metamaskWallet(EXTERNAL)],
      walletsReady: true,
    });
    assert.equal(result.kind, "external");
    assert.equal(result.canExport, false);
    assert.equal(result.exportAddress, null);
  });

  it("multi-HD: profile embedded not returned by primary helper still exports only profile", () => {
    const result = resolveProfileWalletPresentation({
      profileAddress: OTHER,
      // Official helper returns primary HD index, not the profile mark.
      embeddedConnectedAddress: EMBEDDED,
      connectedWallets: [
        embeddedWallet(EMBEDDED),
        embeddedWallet(OTHER),
        metamaskWallet(EXTERNAL),
      ],
      walletsReady: true,
    });
    assert.equal(result.kind, "embedded");
    assert.equal(result.canExport, true);
    assert.equal(result.exportAddress, OTHER);
  });

  it("pending while wallets are not ready — no export claim", () => {
    const result = resolveProfileWalletPresentation({
      profileAddress: EMBEDDED,
      embeddedConnectedAddress: null,
      connectedWallets: [],
      walletsReady: false,
    });
    assert.equal(result.kind, "pending");
    assert.equal(result.canExport, false);
    assert.equal(result.exportAddress, null);
    assert.equal(result.address, EMBEDDED);
  });

  it("ready with missing connector marks profile as external (no export)", () => {
    const result = resolveProfileWalletPresentation({
      profileAddress: EMBEDDED,
      embeddedConnectedAddress: null,
      connectedWallets: [],
      walletsReady: true,
    });
    assert.equal(result.kind, "external");
    assert.equal(result.canExport, false);
  });
});

describe("Outlaw wallet ownership surface (source)", () => {
  const ui = read("components/outlaw/outlaw-wallet.tsx");
  const page = read("app/outlaw/page.tsx");
  const css = read("app/globals.css");
  const logic = read("lib/wallet/privy-embedded.ts");

  it("uses getEmbeddedConnectedWallet + useExportWallet only", () => {
    assert.match(ui, /getEmbeddedConnectedWallet/);
    assert.match(ui, /useExportWallet/);
    assert.match(ui, /useWallets/);
    assert.match(ui, /exportWallet\(\s*\{\s*address:/);
    assert.match(ui, /resolveProfileWalletPresentation/);
    // Imports and callables — not documentation about forbidden paths.
    assert.doesNotMatch(ui, /import\s*\{[^}]*useGetWalletPrivateKey/);
    assert.doesNotMatch(ui, /useGetWalletPrivateKey\s*\(/);
    assert.doesNotMatch(ui, /\bprivateKey\b|\bseedPhrase\b|\bmnemonic\b/);
    assert.doesNotMatch(logic, /useGetWalletPrivateKey|privateKey|seedPhrase/);
  });

  it("renders embedded vs external copy and never exports non-exportAddress", () => {
    assert.match(ui, /YOUR WALLET/);
    assert.match(ui, /A wallet was made when you entered/);
    assert.match(ui, /It belongs to you/);
    assert.match(ui, /YOUR CONNECTED WALLET/);
    assert.match(ui, /This mark is carried by your connected wallet/);
    assert.match(ui, /Keep what Privy reveals private/);
    assert.match(ui, /VELL will never ask to see it/);
    assert.match(ui, /\[ COPY ADDRESS \]/);
    assert.match(ui, /\[ EXPORT WALLET \]/);
    assert.match(ui, /canExport/);
    assert.match(ui, /exportAddress/);
    assert.match(ui, /if \(!presentation\.canExport \|\| !presentation\.exportAddress\)/);
  });

  it("copy feedback is polite and live", () => {
    assert.match(ui, /address copied\./);
    assert.match(ui, /address could not be copied\./);
    assert.match(ui, /aria-live="polite"/);
    assert.match(ui, /aria-label/);
  });

  it("mounted on /outlaw for registered members only; not in account LEAF block alone", () => {
    assert.match(page, /OutlawWallet/);
    assert.ok(page.indexOf("OutlawInvite") < page.indexOf("OutlawWallet"));
    assert.ok(page.indexOf("OutlawWallet") < page.indexOf("outlaw-page__account"));
    assert.doesNotMatch(page, /abbreviateEvmAddress/);
    assert.doesNotMatch(page, /wallet:\s*\n/);
  });

  it("mobile-safe layout without cards or private key UI", () => {
    assert.match(css, /\.outlaw-wallet/);
    assert.match(css, /outlaw-wallet__full/);
    assert.match(css, /overflow-wrap:\s*anywhere/);
    assert.doesNotMatch(css, /\.outlaw-wallet[^{]*\{[^}]*border-radius:\s*[1-9]/);
    assert.doesNotMatch(ui, /className=.*rounded|className=.*shadow|className=.*card/i);
    assert.doesNotMatch(ui, /createPortal|dialog role|role="dialog"/);
    assert.doesNotMatch(ui, /fetch\(|\/api\//);
  });

  it("documents identification approach and never trusts address format alone", () => {
    assert.match(logic, /getEmbeddedConnectedWallet/);
    assert.match(logic, /connectorType === "embedded"/);
    assert.match(logic, /Never infer from address format/);
    assert.match(logic, /Never export unless profile address is confirmed embedded/);
  });
});
