"use client";

import { useCallback, useEffect, useState } from "react";

import { useDeskGate } from "@/components/desk/desk-gate";
import type { DeskTreasurySnapshot } from "@/lib/desk/treasury";

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function DeskTreasuryPanel() {
  const { getAuthHeaders } = useDeskGate();
  const [treasury, setTreasury] = useState<DeskTreasurySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setError("Could not open Treasury.");
      setTreasury(null);
      return;
    }
    const response = await fetch("/api/desk/treasury", {
      headers,
      cache: "no-store",
    });
    const data = (await response.json()) as {
      ok?: boolean;
      treasury?: DeskTreasurySnapshot;
      error?: string;
    };
    if (!response.ok || !data.treasury) {
      setError(data.error ?? "Treasury could not be read.");
      setTreasury(null);
      return;
    }
    setTreasury(data.treasury);
  }, [getAuthHeaders]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void load();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [load]);

  return (
    <section className="desk-treasury" aria-label="The Treasury">
      <div className="desk-hollow__head">
        <h2 className="desk-section-title">THE TREASURY</h2>
        <button type="button" className="btn-text" onClick={() => void load()}>
          [ REFRESH TREASURY ]
        </button>
      </div>
      <p className="muted">Can the Treasury be read? Read-only. No transfers.</p>
      {error ? <p className="muted">{error}</p> : null}
      {!treasury && !error ? <p className="muted">…</p> : null}
      {treasury ? (
        <>
          <h3 className="desk-overview__group-title">STATUS</h3>
          <ul className="desk-member__facts">
            <li>State: {treasury.status}</li>
            <li>RPC configured: {treasury.rpcConfigured ? "yes" : "no"}</li>
            <li>Observed: {treasury.observedAt ?? "—"}</li>
          </ul>

          <h3 className="desk-overview__group-title">WALLET</h3>
          <ul className="desk-member__facts">
            <li>{treasury.walletShort ?? "not configured"}</li>
            {treasury.walletAddress ? (
              <li>
                <button
                  type="button"
                  className="btn-text"
                  onClick={() =>
                    void copyText(treasury.walletAddress!).then((ok) => {
                      if (ok) setCopied(true);
                    })
                  }
                >
                  {copied ? "[ copied ]" : "[ copy address ]"}
                </button>
                {treasury.explorerUrl ? (
                  <a
                    href={treasury.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-text"
                  >
                    [ explorer ]
                  </a>
                ) : null}
              </li>
            ) : null}
          </ul>

          <h3 className="desk-overview__group-title">OFFICIAL FENN CONTRACT</h3>
          <ul className="desk-member__facts">
            {treasury.officialFenn.status === "configured" ? (
              <>
                <li>
                  <code>{treasury.officialFenn.contractAddress}</code>
                </li>
                <li>{treasury.officialFenn.detail}</li>
                {treasury.officialFenn.explorerUrl ? (
                  <li>
                    <a
                      href={treasury.officialFenn.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-text"
                    >
                      [ explorer ]
                    </a>
                  </li>
                ) : null}
              </>
            ) : treasury.officialFenn.status === "needs_attention" ? (
              <li>{treasury.officialFenn.detail}</li>
            ) : (
              <li>{treasury.officialFenn.detail ?? "not configured"}</li>
            )}
          </ul>

          <h3 className="desk-overview__group-title">ASSETS</h3>
          {treasury.assets.length === 0 ? (
            <p className="muted">No tracked assets.</p>
          ) : (
            <ul className="desk-member__list">
              {treasury.assets.map((a) => (
                <li key={a.symbol}>
                  {a.symbol}
                  {a.name ? ` · ${a.name}` : ""} ·{" "}
                  {a.readState === "available" ? a.balance : a.reason}
                  {a.contractAddress ? ` · ${a.contractAddress}` : " · native"}
                </li>
              ))}
            </ul>
          )}

          <h3 className="desk-overview__group-title">COMMONS</h3>
          {!treasury.commonsAvailable ? (
            <p className="muted">Commons commitments unavailable.</p>
          ) : treasury.commons.length === 0 ? (
            <p className="muted">No commitments.</p>
          ) : (
            <ul className="desk-member__list">
              {treasury.commons.map((c) => (
                <li key={c.assetSymbol}>
                  {c.assetSymbol}: {c.amount}
                  {c.valueUsdManual ? ` · $${c.valueUsdManual}` : ""}
                </li>
              ))}
            </ul>
          )}

          <h3 className="desk-overview__group-title">WARNINGS</h3>
          {treasury.warnings.length === 0 ? (
            <p className="muted">None.</p>
          ) : (
            <ul className="desk-member__list">
              {treasury.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
