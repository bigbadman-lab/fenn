"use client";

import {
  getEmbeddedConnectedWallet,
  useExportWallet,
  useWallets,
} from "@privy-io/react-auth";
import { useState } from "react";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { abbreviateSolanaAddress } from "@/lib/wallet/solana";
import { resolveProfileWalletPresentation } from "@/lib/wallet/privy-embedded";

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * YOUR WALLET on /outlaw — profile mark, copy, and Privy export for embedded only.
 *
 * Identification: Privy `getEmbeddedConnectedWallet` first, then the same
 * connector signature for multi-wallet profile matching (see privy-embedded.ts).
 * Export uses `useExportWallet` only — never headless key extraction APIs.
 * Secret material stays inside Privy's official export UI.
 */
export function OutlawWallet() {
  const { authenticated, registered, profile } = useFennAuth();
  const { wallets, ready: walletsReady } = useWallets();
  const { exportWallet } = useExportWallet();
  const [copyState, setCopyState] = useState<"idle" | "ok" | "fail">("idle");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState(false);

  if (!authenticated || !registered || !profile?.walletAddress) {
    return null;
  }

  const embedded = getEmbeddedConnectedWallet(wallets);
  const presentation = resolveProfileWalletPresentation({
    profileAddress: profile.walletAddress,
    embeddedConnectedAddress: embedded?.address ?? null,
    connectedWallets: wallets.map((wallet) => ({
      address: wallet.address,
      walletClientType: wallet.walletClientType,
      connectorType: wallet.connectorType,
      imported: wallet.imported,
    })),
    walletsReady,
  });

  const address = presentation.address || profile.walletAddress;
  const abbreviated = abbreviateSolanaAddress(address);
  const isEmbedded = presentation.kind === "embedded";
  const isExternal = presentation.kind === "external";

  async function onCopy() {
    const ok = await copyText(address);
    setCopyState(ok ? "ok" : "fail");
    window.setTimeout(() => setCopyState("idle"), 2200);
  }

  async function onExport() {
    if (!presentation.canExport || !presentation.exportAddress) return;
    setExportBusy(true);
    setExportError(false);
    try {
      // Official Privy flow only — address is always the FENN profile wallet.
      await exportWallet({ address: presentation.exportAddress });
    } catch {
      setExportError(true);
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <section
      className="outlaw-wallet"
      aria-labelledby="outlaw-wallet-title"
    >
      <p className="outlaw-wallet__rule" aria-hidden>
        --------------------------------
      </p>

      <h2 id="outlaw-wallet-title" className="outlaw-wallet__title">
        {isExternal ? "YOUR CONNECTED WALLET" : "YOUR WALLET"}
      </h2>

      <div className="outlaw-wallet__copy">
        {isExternal ? (
          <p>This mark is carried by your connected wallet.</p>
        ) : (
          <>
            <p>A wallet was made when you entered.</p>
            <p>It belongs to you.</p>
          </>
        )}
      </div>

      <p className="outlaw-wallet__address-label">ADDRESS</p>
      <p className="outlaw-wallet__abbrev" aria-hidden>
        {abbreviated}
      </p>
      <p className="outlaw-wallet__full">
        <code className="outlaw-wallet__full-text" title={address}>
          {address}
        </code>
      </p>

      <div className="outlaw-wallet__actions">
        <button
          type="button"
          className="btn-text outlaw-wallet__btn"
          onClick={() => void onCopy()}
          aria-label="Copy wallet address"
        >
          [ COPY ADDRESS ]
        </button>

        {presentation.canExport ? (
          <button
            type="button"
            className="btn-text outlaw-wallet__btn"
            onClick={() => void onExport()}
            disabled={exportBusy}
            aria-label="Export embedded wallet with Privy"
            aria-busy={exportBusy}
          >
            [ EXPORT WALLET ]
          </button>
        ) : null}
      </div>

      <p className="outlaw-wallet__feedback" aria-live="polite">
        {copyState === "ok"
          ? "address copied."
          : copyState === "fail"
            ? "address could not be copied."
            : exportError
              ? "the seal could not be opened."
              : ""}
      </p>

      {isEmbedded ? (
        <p className="outlaw-wallet__safety muted">
          Keep what Privy reveals private.
          <br />
          VELL will never ask to see it.
        </p>
      ) : null}

      <p className="outlaw-wallet__rule" aria-hidden>
        --------------------------------
      </p>
    </section>
  );
}
