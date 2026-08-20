"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { usePagePulse } from "@/hooks/use-page-pulse";
import {
  FENN_TOKEN_PUBLIC_CHAIN_NAME,
  FENN_TOKEN_PUBLIC_TICKER,
} from "@/lib/treasury/fenn-token-public-identity";
import type { PublicOfficialFennToken } from "@/lib/treasury/types";
import { abbreviateSolanaAddress } from "@/lib/wallet/solana";
import { WORLD_PULSE_LIVE_TICKER_MS } from "@/lib/world-pulse/intervals";

type ApiBody =
  | { ok: true; token: PublicOfficialFennToken | null }
  | { ok?: false };

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Homepage top strip — official $VELL contract from live DB.
 * Polls /api/home/official-token so launch:activate appears without redeploy.
 */
export function HomeHeaderContract() {
  const [token, setToken] = useState<PublicOfficialFennToken | null | undefined>(
    undefined,
  );
  const [copyState, setCopyState] = useState<"idle" | "ok" | "fail">("idle");
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch("/api/home/official-token", {
        cache: "no-store",
      });
      const body = (await response.json()) as ApiBody;
      if (!response.ok || !body || body.ok !== true) {
        setToken((prev) => (prev === undefined ? null : prev));
        return;
      }
      setToken(body.token);
    } catch {
      setToken((prev) => (prev === undefined ? null : prev));
    } finally {
      inFlight.current = false;
    }
  }, []);

  usePagePulse({
    intervalMs: WORLD_PULSE_LIVE_TICKER_MS,
    onPulse: () => {
      void refresh();
    },
    enabled: true,
    refreshOnVisible: true,
  });

  useEffect(() => {
    const t = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(t);
  }, [refresh]);

  async function onCopy() {
    if (!token) return;
    const ok = await copyText(token.contractAddress);
    setCopyState(ok ? "ok" : "fail");
    window.setTimeout(() => setCopyState("idle"), 2200);
  }

  const live = token != null;
  const feedback =
    copyState === "ok"
      ? "copied."
      : copyState === "fail"
        ? "copy failed."
        : null;

  return (
    <header
      className="home-header-contract"
      aria-labelledby="home-header-contract-label"
    >
      <div className="home-header-contract__inner">
        <p className="home-header-contract__meta muted">
          {FENN_TOKEN_PUBLIC_TICKER} · {FENN_TOKEN_PUBLIC_CHAIN_NAME}
        </p>

        <h2
          id="home-header-contract-label"
          className="home-header-contract__title"
        >
          OFFICIAL CONTRACT
        </h2>

        {token === undefined ? (
          <p className="home-header-contract__pending muted" aria-busy="true">
            reading…
          </p>
        ) : live ? (
          <>
            <p className="home-header-contract__address">
              <code
                className="home-header-contract__address-code"
                title={token.contractAddress}
              >
                <span aria-hidden="true">
                  {abbreviateSolanaAddress(token.contractAddress)}
                </span>
                <span className="visually-hidden">{token.contractAddress}</span>
              </code>
            </p>
            <div className="home-header-contract__actions">
              <button
                type="button"
                className="btn-text"
                onClick={() => void onCopy()}
                aria-label="Copy official VELL contract address"
              >
                [ copy ]
              </button>
              <a
                href={token.explorerUrl}
                className="btn-text"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View official VELL mint on Solana explorer"
              >
                [ view ]
              </a>
            </div>
            {feedback ? (
              <p
                className="home-header-contract__feedback muted"
                aria-live="polite"
              >
                {feedback}
              </p>
            ) : null}
          </>
        ) : (
          <p className="home-header-contract__pending" role="status">
            NOT YET INSCRIBED
            <span className="visually-hidden">
              Official $VELL contract address is not yet published.
            </span>
          </p>
        )}
      </div>
    </header>
  );
}
