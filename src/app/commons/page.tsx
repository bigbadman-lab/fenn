import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "The Commons",
};

/**
 * Stage 5 — public Commons surface only.
 * No live commitments, allocations, or Treasury reads yet.
 */
export default function CommonsPage() {
  return (
    <article className="place commons">
      <header className="commons__header">
        <h1 className="place__title">THE COMMONS</h1>
        <pre className="ascii commons__mark" aria-hidden="true">{`          |
      ----+----
     /    |    \\
    v     v     v`}</pre>
        <p className="commons__lede">
          what reaches here
          <br />
          was committed to move.
        </p>
        <p className="commons__aside muted">
          the treasury is where things arrive.
          <br />
          the commons is what fenn has committed to move.
        </p>
      </header>

      <section className="commons-sheet" aria-label="commons accounts">
        <div className="commons-block">
          <h2 className="commons-block__label">AVAILABLE TO CIRCULATE</h2>
          <div className="commons-block__body">
            <p className="commons-empty">nothing committed.</p>
          </div>
        </div>

        <div className="commons-block">
          <h2 className="commons-block__label">CURRENT COMMITMENTS</h2>
          <div className="commons-block__body">
            <table className="commons-table">
              <caption className="visually-hidden">
                Current Commons commitments by asset
              </caption>
              <thead>
                <tr>
                  <th scope="col">ASSET</th>
                  <th scope="col">AMOUNT</th>
                  <th scope="col">COMMITTED</th>
                  <th scope="col">REMAINING</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={4} className="commons-table__empty">
                    none.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="commons-block">
          <h2 className="commons-block__label">NEXT CIRCULATION</h2>
          <div className="commons-block__body">
            <p className="commons-empty">not announced.</p>
          </div>
        </div>
      </section>

      <p className="commons__maxim" role="note">
        A HOARD IS A FAILURE OF CIRCULATION.
      </p>

      <nav className="commons__nav" aria-label="related">
        <Link href="/ledger">[ inspect the ledger ]</Link>
      </nav>
    </article>
  );
}
