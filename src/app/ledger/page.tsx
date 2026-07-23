import type { Metadata } from "next";
import Link from "next/link";

import { AsciiPageTitle } from "@/components/ui/ascii-page-title";

export const metadata: Metadata = {
  title: "The Ledger",
};

/**
 * Stage 5 — public Ledger register shell only.
 * No Circulation history, tx hashes, or explorer links yet.
 */
export default function LedgerPage() {
  return (
    <article className="place ledger">
      <header className="ledger__header">
        <AsciiPageTitle
          title="THE LEDGER"
          mark="LEDGER"
          accent="ledger"
          subtitle={
            <>
              <pre className="ascii ledger__mark" aria-hidden="true">{`      ____________  ____________
     /            \\/            \\
    |···· ··· ··· || ··· ··· ····|
    |-------------|--------------|
    |             ||             |
    |_____________||_____________|`}</pre>
              <p className="ledger__lede">nothing that moves is forgotten.</p>
              <p className="ledger__aside muted">
                the crown hides its books.
                <br />
                the greenwood doesn&apos;t.
              </p>
              <p className="ledger__page-mark" aria-hidden="true">
                PAGE 000
              </p>
            </>
          }
        />
      </header>

      <section className="ledger-register" aria-labelledby="ledger-register-title">
        <h2 id="ledger-register-title" className="ledger-register__title">
          CIRCULATION REGISTER
        </h2>

        <div className="ledger-register__scroll">
          <table className="ledger-table">
            <caption className="visually-hidden">
              Public record of completed Circulations
            </caption>
            <thead>
              <tr>
                <th scope="col">NO.</th>
                <th scope="col">DATE</th>
                <th scope="col">CIRCULATION</th>
                <th scope="col" className="ledger-col--basis">
                  BASIS
                </th>
                <th scope="col">VALUE</th>
                <th scope="col">STATUS</th>
                <th scope="col">PROOF</th>
              </tr>
            </thead>
            <tbody>
              <tr className="ledger-table__empty-row">
                <td colSpan={7}>
                  <div className="ledger-empty">
                    <p>no entries</p>
                    <p className="muted">the first page is blank.</p>
                    <p className="muted">
                      history begins
                      <br />
                      when something moves.
                    </p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="ledger__proof-note muted">proof follows movement.</p>
      </section>

      <nav className="ledger__nav" aria-label="related">
        <Link href="/commons">[ return to the commons ]</Link>
      </nav>
    </article>
  );
}
