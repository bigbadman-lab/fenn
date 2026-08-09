"use client";

import { useState } from "react";

import {
  FENN_TOKEN_PUBLIC_CHAIN_ID,
  FENN_TOKEN_PUBLIC_CHAIN_NAME,
  FENN_TOKEN_PUBLIC_TICKER,
} from "@/lib/treasury/fenn-token-public-identity";
import type { PublicOfficialFennToken } from "@/lib/treasury/types";

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

type Variant = "commons" | "home";

type Props = {
  /**
   * Trusted DB-backed official token, or null when unresolved.
   * Never invent an address when null.
   */
  token: PublicOfficialFennToken | null;
  variant?: Variant;
};

/**
 * Public official $FENN contract strip.
 * Source of truth is server-trusted PublicOfficialFennToken — never client-picked.
 * Pending (null) is intentional pre-launch state. Copy always uses the full address.
 */
export function OfficialFennContract({ token, variant = "commons" }: Props) {
  const [copyState, setCopyState] = useState<"idle" | "ok" | "fail">("idle");
  const isHome = variant === "home";
  const live = token != null;

  async function onCopy() {
    if (!token) return;
    const ok = await copyText(token.contractAddress);
    setCopyState(ok ? "ok" : "fail");
    window.setTimeout(() => setCopyState("idle"), 2200);
  }

  const feedback =
    copyState === "ok"
      ? "contract copied."
      : copyState === "fail"
        ? "the contract could not be copied."
        : null;

  if (isHome) {
    return (
      <section
        className="home-section home-official-token"
        aria-labelledby="home-official-token-heading"
      >
        <p className="home-official-token__chain muted">
          {FENN_TOKEN_PUBLIC_TICKER} · {FENN_TOKEN_PUBLIC_CHAIN_NAME}
        </p>
        <h2 id="home-official-token-heading" className="home-official-token__title">
          OFFICIAL CONTRACT
        </h2>
        {live ? (
          <>
            <p className="home-official-token__address-line">
              <code
                className="home-official-token__address"
                title={token.contractAddress}
              >
                <span className="home-official-token__short" aria-hidden="true">
                  {`${token.contractAddress.slice(0, 6)}…${token.contractAddress.slice(-4)}`}
                </span>
                <span className="visually-hidden">{token.contractAddress}</span>
              </code>
            </p>
            <p className="home-official-token__full muted" aria-hidden="true">
              <code className="home-official-token__full-code">
                {token.contractAddress}
              </code>
            </p>
            <div className="home-official-token__actions">
              <button
                type="button"
                className="btn-text"
                onClick={() => void onCopy()}
                aria-label="Copy official FENN contract address"
              >
                [ COPY ]
              </button>
              <a
                href={token.explorerUrl}
                className="btn-text"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View official FENN contract on Robinhood Chain explorer"
              >
                [ VIEW CONTRACT ]
              </a>
            </div>
            {feedback ? (
              <p className="home-official-token__feedback muted" aria-live="polite">
                {feedback}
              </p>
            ) : null}
          </>
        ) : (
          <p className="home-official-token__pending" role="status">
            NOT YET INSCRIBED
            <span className="visually-hidden">
              . Official $FENN contract address is not yet published. Robinhood
              Chain. No contract address available.
            </span>
          </p>
        )}
      </section>
    );
  }

  return (
    <section
      className="commons-block"
      aria-labelledby="official-fenn-contract-heading"
    >
      <h2 id="official-fenn-contract-heading" className="commons-block__label">
        OFFICIAL CONTRACT
      </h2>
      <div className="commons-block__body commons-official-token">
        <p className="commons-official-token__chain muted">
          {FENN_TOKEN_PUBLIC_CHAIN_NAME} · {FENN_TOKEN_PUBLIC_CHAIN_ID}
        </p>
        {live ? (
          <>
            <p className="commons-official-token__address-line">
              <code className="commons-official-token__address">
                {token.contractAddress}
              </code>
            </p>
            <div className="commons-official-token__actions">
              <button
                type="button"
                className="btn-text"
                onClick={() => void onCopy()}
                aria-label="Copy official FENN contract address"
              >
                [ COPY ]
              </button>
              <a
                href={token.explorerUrl}
                className="btn-text"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View official FENN contract on Robinhood Chain explorer"
              >
                [ VIEW CONTRACT ]
              </a>
            </div>
            {feedback ? (
              <p
                className="commons-official-token__feedback muted"
                aria-live="polite"
              >
                {feedback}
              </p>
            ) : null}
          </>
        ) : (
          <p className="commons-official-token__pending" role="status">
            NOT YET INSCRIBED
            <span className="visually-hidden">
              . Official $FENN contract address is not yet published. No copy or
              explorer link available.
            </span>
          </p>
        )}
      </div>
    </section>
  );
}
