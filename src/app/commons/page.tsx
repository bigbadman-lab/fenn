import type { Metadata } from "next";
import Link from "next/link";

import { CommonsCommitments } from "@/components/commons/commons-commitments";
import { CommonsHistory } from "@/components/commons/commons-history";
import { TreasuryReadout } from "@/components/commons/treasury-readout";
import { AsciiPageTitle } from "@/components/ui/ascii-page-title";
import { loadCommonsPageData } from "@/lib/commons/page-data";

export const metadata: Metadata = {
  title: "The Commons",
};

export const dynamic = "force-dynamic";

/**
 * Public Treasury + Commons surface.
 * Holdings and commitments are separate facts — no available/remaining calc.
 */
export default async function CommonsPage() {
  const { treasury, commons } = await loadCommonsPageData();

  return (
    <article className="place commons">
      <header className="commons__header">
        <AsciiPageTitle
          title="THE COMMONS"
          mark="COMMONS"
          accent="commons"
          subtitle={
            <>
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
            </>
          }
        />
      </header>

      <div className="commons-sheet" aria-label="treasury and commons accounts">
        <TreasuryReadout treasury={treasury} />
        <CommonsCommitments commons={commons} />
        <CommonsHistory commons={commons} />

        <section
          className="commons-block"
          aria-labelledby="next-circulation-heading"
        >
          <h2 id="next-circulation-heading" className="commons-block__label">
            NEXT CIRCULATION
          </h2>
          <div className="commons-block__body">
            <p className="commons-empty">not announced.</p>
          </div>
        </section>
      </div>

      <p className="commons__maxim" role="note">
        A HOARD IS A FAILURE OF CIRCULATION.
      </p>

      <nav className="commons__nav" aria-label="related">
        <Link href="/ledger">[ OPEN THE LEDGER ]</Link>
      </nav>
    </article>
  );
}
