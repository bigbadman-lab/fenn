import {
  formatCommonsHistoryDate,
  formatTreasuryObservedAt,
} from "@/lib/commons/format";
import type { CommonsPagePurse } from "@/lib/commons/page-data";
import { abbreviateEvmAddress } from "@/lib/wallet/evm";

type Props = {
  purse: CommonsPagePurse;
};

/**
 * THE PURSE OF FENN — dedicated hot wallet of official FENN.
 * Presentation only. Live balance + confirmed outbound history.
 * No pending/failed settlement internals. No private keys.
 */
export function PurseReadout({ purse }: Props) {
  if (purse.state === "error") {
    return (
      <section className="commons-block" aria-labelledby="purse-heading">
        <h2 id="purse-heading" className="commons-block__label">
          THE PURSE OF FENN
        </h2>
        <div className="commons-block__body">
          <p className="commons-empty">the purse cannot be read.</p>
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
            A finite quantity of FENN may be placed
            <br />
            in FENN&apos;s keeping.
          </p>
          <p className="commons-empty commons-empty--spaced">
            the purse is not yet set.
          </p>
        </div>
      </section>
    );
  }

  const observed = formatTreasuryObservedAt(purse.observedAt);
  const balanceUnavailable = purse.fennBalance.state === "unavailable";
  const balanceText =
    purse.fennBalance.state === "available"
      ? purse.fennBalance.balance
      : null;

  return (
    <section className="commons-block" aria-labelledby="purse-heading">
      <h2 id="purse-heading" className="commons-block__label">
        THE PURSE OF FENN
      </h2>
      <div className="commons-block__body">
        <p className="commons-section__lede">
          A finite quantity of FENN may be placed
          <br />
          in FENN&apos;s keeping.
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

        {balanceUnavailable || purse.state === "unavailable" ? (
          <p className="commons-empty commons-empty--spaced">
            the address is known.
            <br />
            the balance cannot be read just now.
          </p>
        ) : (
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
