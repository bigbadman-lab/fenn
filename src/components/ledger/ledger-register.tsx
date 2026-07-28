import Link from "next/link";

import {
  formatLedgerLeafAmount,
  formatLedgerRecognitionTime,
  formatLedgerTotal,
} from "@/lib/ledger/format";
import type {
  PublicLedgerPageData,
  PublicLedgerRecognition,
  PublicLedgerStandingRow,
  PublicLedgerTotals,
} from "@/lib/ledger/types";

type Props = {
  data: PublicLedgerPageData;
  olderHref: string | null;
};

export function LedgerRegister({ data, olderHref }: Props) {
  if (data.state === "unavailable") {
    return (
      <p className="ledger-unavailable">
        the ledger cannot be read just now.
      </p>
    );
  }

  return (
    <>
      <LedgerTotals totals={data.totals} />
      <LedgerRecognitionList entries={data.entries} olderHref={olderHref} />
      {data.standing.length > 0 ? (
        <LedgerStanding standing={data.standing} />
      ) : null}
    </>
  );
}

function LedgerTotals({ totals }: { totals: PublicLedgerTotals }) {
  return (
    <section className="ledger-totals" aria-labelledby="ledger-totals-title">
      <h2 id="ledger-totals-title" className="visually-hidden">
        Recognition totals
      </h2>
      <dl className="ledger-totals__grid">
        <div className="ledger-totals__item">
          <dt>CURRENT RECOGNITION</dt>
          <dd>
            {formatLedgerTotal(totals.currentRecognised)}{" "}
            <span className="ledger-totals__unit">LEAF</span>
          </dd>
        </div>
        <div className="ledger-totals__item">
          <dt>ALL-TIME</dt>
          <dd>
            {formatLedgerTotal(totals.lifetimeRecognised)}{" "}
            <span className="ledger-totals__unit">LEAF</span>
          </dd>
        </div>
      </dl>
    </section>
  );
}

function LedgerRecognitionList({
  entries,
  olderHref,
}: {
  entries: PublicLedgerRecognition[];
  olderHref: string | null;
}) {
  return (
    <section
      className="ledger-recognition"
      aria-labelledby="ledger-recognition-title"
    >
      <h2 id="ledger-recognition-title" className="ledger-recognition__title">
        RECENT RECOGNITION
      </h2>

      {entries.length === 0 ? (
        <div className="ledger-empty">
          <p>no recognition yet.</p>
          <p className="muted">the register is blank.</p>
          <p className="muted">
            history begins
            <br />
            when something matters.
          </p>
        </div>
      ) : (
        <ol className="ledger-recognition__list">
          {entries.map((entry) => (
            <li key={entry.id} className="ledger-entry">
              <p className="ledger-entry__amount">
                {formatLedgerLeafAmount(entry.amount)} LEAF
              </p>
              <p className="ledger-entry__outlaw">{entry.outlawLabel}</p>
              <p className="ledger-entry__summary">{entry.summary}</p>
              <p className="ledger-entry__meta">
                <span className="ledger-entry__category">{entry.category}</span>
                <span className="ledger-entry__sep" aria-hidden="true">
                  ·
                </span>
                <time dateTime={entry.createdAt}>
                  {formatLedgerRecognitionTime(entry.createdAt)}
                </time>
              </p>
            </li>
          ))}
        </ol>
      )}

      {olderHref ? (
        <p className="ledger-recognition__older">
          <Link href={olderHref}>[ older entries ]</Link>
        </p>
      ) : null}
    </section>
  );
}

function LedgerStanding({
  standing,
}: {
  standing: PublicLedgerStandingRow[];
}) {
  return (
    <section className="ledger-standing" aria-labelledby="ledger-standing-title">
      <h2 id="ledger-standing-title" className="ledger-standing__title">
        STANDING
      </h2>
      <p className="ledger-standing__aside muted">
        lifetime recognition across Outlaws.
      </p>
      <ol className="ledger-standing__list">
        {standing.map((row) => (
          <li key={row.outlawNumber} className="ledger-standing__row">
            <span className="ledger-standing__rank">
              {String(row.rank).padStart(2, "0")}
            </span>
            <span className="ledger-standing__name">{row.outlawLabel}</span>
            <span className="ledger-standing__leaf">
              {formatLedgerTotal(row.lifetimeLeaf)} LEAF
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
