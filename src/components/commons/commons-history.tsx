import {
  formatCommitmentDelta,
  formatCommonsHistoryDate,
} from "@/lib/commons/format";
import type { CommonsPageCommons } from "@/lib/commons/page-data";

type Props = {
  commons: CommonsPageCommons;
};

/**
 * Commitment-change history — not Circulations or recipient movement.
 */
export function CommonsHistory({ commons }: Props) {
  if (commons.state === "error") {
    return null;
  }

  const history = commons.allocationHistory;

  return (
    <section
      className="commons-block"
      aria-labelledby="commons-history-heading"
    >
      <h2 id="commons-history-heading" className="commons-block__label">
        CHANGES TO THE COMMONS
      </h2>
      <div className="commons-block__body">
        {history.state === "unavailable" ? (
          <p className="commons-empty">
            the older marks cannot be read just now.
          </p>
        ) : history.items.length === 0 ? (
          <p className="commons-empty">no changes recorded yet.</p>
        ) : (
          <ul className="commons-history">
            {history.items.map((row) => (
              <li key={row.id} className="commons-history__item">
                <time
                  className="commons-history__date muted"
                  dateTime={row.createdAt}
                >
                  {formatCommonsHistoryDate(row.createdAt)}
                </time>
                <p className="commons-history__delta">
                  {formatCommitmentDelta(row.deltaAmount)} {row.assetSymbol}
                </p>
                <p className="commons-history__reason">{row.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
