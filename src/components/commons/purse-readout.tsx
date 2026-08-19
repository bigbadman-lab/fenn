import {
  formatCommonsHistoryDate,
  formatTreasuryObservedAt,
} from "@/lib/commons/format";
import type { CommonsPagePurse } from "@/lib/commons/page-data";
import {
  FENN_TOKEN_PUBLIC_INITIAL_PURSE_FORMATTED,
  FENN_TOKEN_PUBLIC_INITIAL_PURSE_PCT,
  FENN_TOKEN_PUBLIC_TOTAL_SUPPLY_FORMATTED,
} from "@/lib/treasury/fenn-token-public-identity";
import { abbreviateEvmAddress } from "@/lib/wallet/evm";
import type {
  PublicPurseEthBalance,
  PublicPurseFennBalance,
} from "@/lib/purse/types";

type Props = {
  purse: CommonsPagePurse;
  /**
   * Whether official $FENN contract is resolved (DB-backed).
   * Distinct from whether chain balance read succeeded.
   */
  officialTokenResolved?: boolean;
};

/**
 * THE PURSE OF FENN — dedicated hot wallet of official FENN (+ native gas).
 * Presentation only. Live balances + confirmed outbound history.
 * No pending/failed settlement internals. No private keys.
 * Initial 10m allocation is context — never presented as permanent balance.
 */
export function PurseReadout({
  purse,
  officialTokenResolved = false,
}: Props) {
  if (purse.state === "error") {
    return (
      <section className="commons-block" aria-labelledby="purse-heading">
        <h2 id="purse-heading" className="commons-block__label">
          THE PURSE OF VELL
        </h2>
        <div className="commons-block__body">
          <p className="commons-empty">the purse cannot be read.</p>
          <InitialPurseAllocationNote />
        </div>
      </section>
    );
  }

  if (purse.state === "unconfigured") {
    return (
      <section className="commons-block" aria-labelledby="purse-heading">
        <h2 id="purse-heading" className="commons-block__label">
          THE PURSE OF VELL
        </h2>
        <div className="commons-block__body">
          <p className="commons-section__lede">
            A finite quantity of $VELL under VELL&apos;s keeping.
          </p>
          <p className="commons-section__aside muted">
            distinct from the Treasury.
            <br />
            judgement may use it; authority may refuse.
            <br />
            settlement is real only after chain confirmation.
          </p>
          <p className="commons-empty commons-empty--spaced">
            the purse is not yet set.
          </p>
          <InitialPurseAllocationNote />
        </div>
      </section>
    );
  }

  const observed = formatTreasuryObservedAt(purse.observedAt);
  const ethBalance = purse.ethBalance;
  const fennBalance = purse.fennBalance;
  const fennAwaitingOfficial =
    !officialTokenResolved ||
    (fennBalance.state === "unavailable" &&
      fennBalance.reason === "token_unavailable");

  return (
    <section className="commons-block" aria-labelledby="purse-heading">
      <h2 id="purse-heading" className="commons-block__label">
        THE PURSE OF VELL
      </h2>
      <div className="commons-block__body">
        <p className="commons-section__lede">
          A finite quantity of $VELL under VELL&apos;s keeping.
        </p>
        {!purse.isEnabled ? (
          <p className="commons-section__aside muted">the purse is at rest.</p>
        ) : (
          <p className="commons-section__aside muted">
            finite under VELL&apos;s keeping — not the Treasury.
            <br />
            judgement may use it; authority may refuse.
            <br />
            only confirmed movements are shown here.
          </p>
        )}

        <p className="commons-wallet">
          <span className="commons-wallet__label">wallet</span>{" "}
          <code className="commons-wallet__address">{purse.purseAddress}</code>
        </p>
        <p className="commons-section__aside muted commons-purse-wallet-note">
          this is the Purse wallet — not the $VELL token contract.
        </p>

        <InitialPurseAllocationNote />

        <h3 className="commons-subheading">LIVE BALANCES</h3>
        <table className="commons-table commons-table--treasury">
          <caption className="visually-hidden">
            Live Purse ETH and official VELL balances
          </caption>
          <thead>
            <tr>
              <th scope="col">ASSET</th>
              <th scope="col">HELD</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className="commons-table__asset">
                <span className="commons-table__symbol">ETH</span>
                <span className="commons-table__name muted">ETH HELD</span>
              </th>
              <td className={purseHeldCellClass(ethBalance)}>
                <PurseHeldValue
                  text={ethHeldDisplay(ethBalance)}
                  available={ethBalance.state === "available"}
                />
              </td>
            </tr>
            <tr>
              <th scope="row" className="commons-table__asset">
                <span className="commons-table__symbol">VELL</span>
                <span className="commons-table__name muted">VELL HELD</span>
              </th>
              <td
                className={
                  fennAwaitingOfficial
                    ? "commons-table__amount commons-table__amount--muted"
                    : purseHeldCellClass(fennBalance)
                }
              >
                <PurseHeldValue
                  text={fennHeldDisplay(fennBalance, fennAwaitingOfficial)}
                  available={
                    !fennAwaitingOfficial && fennBalance.state === "available"
                  }
                />
              </td>
            </tr>
          </tbody>
        </table>
        {fennAwaitingOfficial ? (
          <p className="commons-empty commons-empty--spaced" role="status">
            awaiting official token for VELL HELD.
            <span className="visually-hidden">
              {" "}
              Official on-chain $VELL balance cannot be shown until the official
              contract is configured. The initial allocation figure above is
              launch intent, not a live balance.
            </span>
          </p>
        ) : null}

        {observed ? (
          <p className="commons-observed muted">{observed}</p>
        ) : null}

        <h3 className="commons-subheading">MOVEMENTS</h3>
        {purse.transfers.length === 0 ? (
          <p className="commons-empty">no confirmed movements yet.</p>
        ) : (
          <ul className="commons-history">
            {purse.transfers.map((row) => {
              const shortTo = abbreviateEvmAddress(row.recipientAddress);
              return (
                <li key={row.id} className="commons-history__item">
                  <time
                    className="commons-history__date muted"
                    dateTime={row.confirmedAt}
                  >
                    {formatCommonsHistoryDate(row.confirmedAt)}
                  </time>
                  <p className="commons-history__delta">
                    {row.actionType === "burn"
                      ? `${row.amountFormatted} VELL burned`
                      : `${row.amountFormatted} VELL → ${shortTo}`}
                  </p>
                  {row.explorerTxUrl ? (
                    <p className="commons-history__reason">
                      <a
                        href={row.explorerTxUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        view on Robinhood Chain
                      </a>
                    </p>
                  ) : (
                    <p className="commons-history__reason muted">
                      {row.txHash.slice(0, 10)}…
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function InitialPurseAllocationNote() {
  return (
    <div className="commons-purse-initial">
      <h3 className="commons-subheading">INITIAL ALLOCATION</h3>
      <p className="commons-purse-initial__value">
        {FENN_TOKEN_PUBLIC_INITIAL_PURSE_FORMATTED} VELL
      </p>
      <p className="commons-section__aside muted">
        {FENN_TOKEN_PUBLIC_INITIAL_PURSE_PCT} of total supply (
        {FENN_TOKEN_PUBLIC_TOTAL_SUPPLY_FORMATTED} VELL).
        <br />
        launch intent — not a permanent balance.
      </p>
    </div>
  );
}

/** ETH: trim trailing fractional zeros; keep compact readable precision. */
export function formatPurseEthHeld(formatted: string): string {
  const trimmed = formatted.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  const [whole, frac = ""] = trimmed.split(".");
  if (!frac || !/[1-9]/.test(frac)) return whole.replace(/^0+(?=\d)/, "") || "0";
  const fracTrimmed = frac.replace(/0+$/, "");
  // Cap display to 6 fractional digits without inventing magnitude (string ops only).
  const fracCapped = fracTrimmed.slice(0, 6).replace(/0+$/, "");
  if (!fracCapped) return whole.replace(/^0+(?=\d)/, "") || "0";
  return `${whole.replace(/^0+(?=\d)/, "") || "0"}.${fracCapped}`;
}

function ethHeldDisplay(balance: PublicPurseEthBalance): string {
  if (balance.state === "available") {
    return formatPurseEthHeld(balance.balance);
  }
  // Commons-style unavailable (matches treasuryAssetBalanceDisplay).
  return "unseen.";
}

function fennHeldDisplay(
  balance: PublicPurseFennBalance,
  awaitingOfficial: boolean,
): string {
  if (awaitingOfficial) return "—";
  if (balance.state === "available") return balance.balance;
  return "unseen.";
}

function purseHeldCellClass(
  balance: PublicPurseEthBalance | PublicPurseFennBalance,
): string {
  if (balance.state === "available") return "commons-table__amount";
  return "commons-table__amount commons-table__amount--muted";
}

function PurseHeldValue({
  text,
  available,
}: {
  text: string;
  available: boolean;
}) {
  if (available) return text;
  return (
    <>
      <span aria-hidden="true">{text}</span>
      <span className="visually-hidden">balance unavailable</span>
    </>
  );
}
