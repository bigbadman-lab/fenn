import type { CommonsPageCommons } from "@/lib/commons/page-data";

type Props = {
  commons: CommonsPageCommons;
};

/**
 * THE COMMONS — what FENN has committed to move.
 * Current amounts from commons_commitments only. No Treasury subtraction.
 */
export function CommonsCommitments({ commons }: Props) {
  if (commons.state === "error") {
    return (
      <section className="commons-block" aria-labelledby="commons-heading">
        <h2 id="commons-heading" className="commons-block__label">
          THE COMMONS
        </h2>
        <div className="commons-block__body">
          <p className="commons-empty">the account cannot be read.</p>
        </div>
      </section>
    );
  }

  const { commitments } = commons;

  return (
    <section className="commons-block" aria-labelledby="commons-heading">
      <h2 id="commons-heading" className="commons-block__label">
        THE COMMONS
      </h2>
      <div className="commons-block__body">
        <p className="commons-section__lede">
          what FENN has committed to move.
        </p>
        <p className="commons-section__aside muted">
          committed is not yet moved.
        </p>

        {commitments.length === 0 ? (
          <p className="commons-empty commons-empty--spaced">
            nothing is currently committed.
          </p>
        ) : (
          <table className="commons-table commons-table--commitments">
            <caption className="visually-hidden">
              Current Commons commitments by asset
            </caption>
            <thead>
              <tr>
                <th scope="col">ASSET</th>
                <th scope="col">COMMITTED</th>
              </tr>
            </thead>
            <tbody>
              {commitments.map((row) => (
                <tr key={row.assetSymbol}>
                  <th scope="row" className="commons-table__asset">
                    <span className="commons-table__symbol">
                      {row.assetSymbol}
                    </span>
                  </th>
                  <td className="commons-table__amount">{row.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
