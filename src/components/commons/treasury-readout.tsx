import {
  formatTreasuryObservedAt,
  treasuryAssetBalanceDisplay,
} from "@/lib/commons/format";
import type { CommonsPageTreasury } from "@/lib/commons/page-data";
import type { PublicTreasuryContribution } from "@/lib/treasury/types";

type Props = {
  treasury: CommonsPageTreasury;
};

/**
 * THE TREASURY — what FENN holds (live chain reads).
 * Presentation only; no accounting.
 */
export function TreasuryReadout({ treasury }: Props) {
  if (treasury.state === "error") {
    return (
      <section className="commons-block" aria-labelledby="treasury-heading">
        <h2 id="treasury-heading" className="commons-block__label">
          THE TREASURY
        </h2>
        <div className="commons-block__body">
          <p className="commons-empty">the account cannot be read.</p>
        </div>
      </section>
    );
  }

  if (treasury.state === "unconfigured") {
    return (
      <section className="commons-block" aria-labelledby="treasury-heading">
        <h2 id="treasury-heading" className="commons-block__label">
          THE TREASURY
        </h2>
        <div className="commons-block__body">
          <p className="commons-section__lede">what FENN holds.</p>
          <p className="commons-empty">
            nothing has been fixed here yet.
          </p>
        </div>
      </section>
    );
  }

  const observed = formatTreasuryObservedAt(treasury.observedAt);
  const isChainDown = treasury.state === "unavailable";

  return (
    <section className="commons-block" aria-labelledby="treasury-heading">
      <h2 id="treasury-heading" className="commons-block__label">
        THE TREASURY
      </h2>
      <div className="commons-block__body">
        <p className="commons-section__lede">what FENN holds.</p>
        <p className="commons-section__aside muted">where things arrive.</p>

        <p className="commons-wallet">
          <span className="commons-wallet__label">wallet</span>{" "}
          <code className="commons-wallet__address">
            {treasury.treasuryAddress}
          </code>
        </p>

        {isChainDown ? (
          <p className="commons-empty commons-empty--spaced">
            the address is known.
            <br />
            the chain cannot be read just now.
          </p>
        ) : null}

        {treasury.assets.length === 0 && !isChainDown ? (
          <p className="commons-empty commons-empty--spaced">
            no assets are marked for reading.
          </p>
        ) : treasury.assets.length > 0 ? (
          <table className="commons-table commons-table--treasury">
            <caption className="visually-hidden">
              Live Treasury asset balances
            </caption>
            <thead>
              <tr>
                <th scope="col">ASSET</th>
                <th scope="col">HELD</th>
              </tr>
            </thead>
            <tbody>
              {treasury.assets.map((asset) => {
                const display = treasuryAssetBalanceDisplay(asset);
                return (
                  <tr key={`${asset.chainId}:${asset.symbol}:${asset.contractAddress ?? "native"}`}>
                    <th scope="row" className="commons-table__asset">
                      <span className="commons-table__symbol">{asset.symbol}</span>
                      {asset.name ? (
                        <span className="commons-table__name muted">
                          {asset.name}
                        </span>
                      ) : null}
                    </th>
                    <td
                      className={
                        display.kind === "unavailable"
                          ? "commons-table__amount commons-table__amount--muted"
                          : "commons-table__amount"
                      }
                    >
                      {display.kind === "unavailable" ? (
                        <>
                          <span aria-hidden="true">{display.value}</span>
                          <span className="visually-hidden">
                            balance unavailable
                          </span>
                        </>
                      ) : (
                        display.value
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}

        {observed ? (
          <p className="commons-observed muted">
            <time dateTime={treasury.observedAt}>{observed}</time>
          </p>
        ) : null}

        <TreasuryArrivals contributions={treasury.contributions} />
      </div>
    </section>
  );
}

function TreasuryArrivals({
  contributions,
}: {
  contributions: PublicTreasuryContribution[];
}) {
  if (contributions.length === 0) {
    return null;
  }

  return (
    <div className="commons-arrivals">
      <h3 className="commons-arrivals__label">ARRIVALS</h3>
      <p className="commons-arrivals__note muted">
        verified arrivals are history, not the current balance.
      </p>
      <ul className="commons-arrivals__list">
        {contributions.map((row) => (
          <li key={row.id} className="commons-arrivals__item">
            <p className="commons-arrivals__line">
              <span className="commons-arrivals__amount">
                {row.amount} {row.assetSymbol}
              </span>
              {row.projectName ? (
                <span className="commons-arrivals__from">
                  {" "}
                  from {row.projectName}
                </span>
              ) : null}
            </p>
            {row.purpose ? (
              <p className="commons-arrivals__purpose muted">{row.purpose}</p>
            ) : null}
            {row.txHash ? (
              <p className="commons-arrivals__tx muted">
                <code title={row.txHash}>{abbreviateTxHash(row.txHash)}</code>
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function abbreviateTxHash(hash: string): string {
  const trimmed = hash.trim();
  if (trimmed.length < 14) return trimmed;
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-6)}`;
}
