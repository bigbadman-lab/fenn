"use client";

import { useState } from "react";

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
  token: PublicOfficialFennToken;
  variant?: Variant;
};

/**
 * Public official $FENN contract strip.
 * Source of truth is server-trusted PublicOfficialFennToken — never client-picked.
 * Copy always uses the full address. Presentation only — no chain writes.
 */
export function OfficialFennContract({ token, variant = "commons" }: Props) {
  const [copyState, setCopyState] = useState<"idle" | "ok" | "fail">("idle");
  const full = token.contractAddress;
  const short = `${full.slice(0, 6)}…${full.slice(-4)}`;
  const isHome = variant === "home";

  async function onCopy() {
    const ok = await copyText(full);
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
          FENN · ROBINHOOD CHAIN
        </p>
        <h2 id="home-official-token-heading" className="home-official-token__title">
          OFFICIAL CONTRACT
        </h2>
        <p className="home-official-token__address-line">
          <code className="home-official-token__address" title={full}>
            <span className="home-official-token__short" aria-hidden="true">
              {short}
            </span>
            <span className="visually-hidden">{full}</span>
          </code>
        </p>
        <p className="home-official-token__full muted" aria-hidden="true">
          {/* selectable full address without competing with the map */}
          <code className="home-official-token__full-code">{full}</code>
        </p>
        <div className="home-official-token__actions">
          <button
            type="button"
            className="btn-text"
            onClick={() => void onCopy()}
          >
            [ COPY ]
          </button>
          <a
            href={token.explorerUrl}
            className="btn-text"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Verify official FENN contract on Robinhood Chain explorer"
          >
            [ VERIFY ]
          </a>
        </div>
        {feedback ? (
          <p className="home-official-token__feedback muted" aria-live="polite">
            {feedback}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section
      className="commons-block"
      aria-labelledby="official-fenn-contract-heading"
    >
      <h2 id="official-fenn-contract-heading" className="commons-block__label">
        OFFICIAL FENN CONTRACT
      </h2>
      <div className="commons-block__body commons-official-token">
        <p className="commons-official-token__chain muted">
          ROBINHOOD CHAIN · {token.chainId}
        </p>
        <p className="commons-official-token__address-line">
          <code className="commons-official-token__address">{full}</code>
        </p>
        <div className="commons-official-token__actions">
          <button
            type="button"
            className="btn-text"
            onClick={() => void onCopy()}
          >
            [ COPY CONTRACT ]
          </button>
          <a
            href={token.explorerUrl}
            className="btn-text"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View official FENN contract on Robinhood Chain explorer"
          >
            [ VIEW ON ROBINHOOD CHAIN ]
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
      </div>
    </section>
  );
}
