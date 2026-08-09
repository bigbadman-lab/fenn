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

type Props = {
  purse: CommonsPagePurse;
  /**
   * Whether official $FENN contract is resolved (DB-backed).
   * Distinct from whether chain balance read succeeded.
   */
  officialTokenResolved?: boolean;
};

/**
 * THE PURSE OF FENN — dedicated hot wallet of official FENN.
 * Presentation only. Live balance + confirmed outbound history.
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
          THE PURSE OF FENN
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
          THE PURSE OF FENN
        </h2>
        <div className="commons-block__body">
          <p className="commons-section__lede">
            A finite quantity of $FENN under FENN&apos;s keeping.
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
  const fennBalance = purse.fennBalance;
  const balanceText =
    fennBalance.state === "available" ? fennBalance.balance : null;
  const tokenAwaiting =
    !officialTokenResolved ||
    (fennBalance.state === "unavailable" &&
      fennBalance.reason === "token_unavailable");

  return (
    <section className="commons-block" aria-labelledby="purse-heading">
      <h2 id="purse-heading" className="commons-block__label">
        THE PURSE OF FENN
      </h2>
      <div className="commons-block__body">
        <p className="commons-section__lede">
          A finite quantity of $FENN under FENN&apos;s keeping.
        </p>
        {!purse.isEnabled ? (
          <p className="commons-section__aside muted">the purse is at rest.</p>
        ) : (
          <p className="commons-section__aside muted">
            finite under FENN&apos;s keeping — not the Treasury.
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
          this is the Purse wallet — not the $FENN token contract.
        </p>

        <InitialPurseAllocationNote />

        <h3 className="commons-subheading">CURRENT $FENN BALANCE</h3>
        {tokenAwaiting ? (
          <p className="commons-empty commons-empty--spaced" role="status">
            awaiting official token.
            <span className="visually-hidden">
              {" "}
              Current on-chain $FENN balance cannot be shown until the official
              contract is configured. The initial allocation figure above is
              launch intent, not a live balance.
            </span>
          </p>
        ) : balanceText != null ? (
          <table className="commons-table commons-table--treasury">
            <caption className="visually-hidden">
              Live Purse official FENN balance
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
                  <span className="commons-table__symbol">FENN</span>
                </th>
                <td className="commons-table__amount">{balanceText}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="commons-empty commons-empty--spaced">
            the address is known.
            <br />
            the balance cannot be read just now.
          </p>
        )}

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
                      ? `${row.amountFormatted} FENN burned`
                      : `${row.amountFormatted} FENN → ${shortTo}`}
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
        {FENN_TOKEN_PUBLIC_INITIAL_PURSE_FORMATTED} FENN
      </p>
      <p className="commons-section__aside muted">
        {FENN_TOKEN_PUBLIC_INITIAL_PURSE_PCT} of total supply (
        {FENN_TOKEN_PUBLIC_TOTAL_SUPPLY_FORMATTED} FENN).
        <br />
        launch intent — not a permanent balance.
      </p>
    </div>
  );
}
