import type { Metadata } from "next";
import Link from "next/link";

import { CommonsCommitments } from "@/components/commons/commons-commitments";
import { CommonsHistory } from "@/components/commons/commons-history";
import { FennTokenIdentity } from "@/components/commons/fenn-token-identity";
import { OfficialFennContract } from "@/components/commons/official-fenn-contract";
import { PurseReadout } from "@/components/commons/purse-readout";
import { TreasuryReadout } from "@/components/commons/treasury-readout";
import { AsciiPageTitle } from "@/components/ui/ascii-page-title";
import { PagePulse } from "@/components/world-pulse/page-pulse";
import { loadCommonsPageData } from "@/lib/commons/page-data";
import { buildPublicMetadata } from "@/lib/site/metadata";
import { WORLD_PULSE_COMMONS_MS } from "@/lib/world-pulse/intervals";

export const metadata: Metadata = buildPublicMetadata({
  title: "THE COMMONS",
  description:
    "The FENN Treasury, $FENN, the Purse, public commitments and the official contract in full view.",
  path: "/commons",
});

export const dynamic = "force-dynamic";

/**
 * Public Treasury + Commons + $FENN surface.
 * Holdings and commitments are separate facts — no available/remaining calc.
 * Official CA is live resolution only (pending when unset).
 */
export default async function CommonsPage() {
  const { treasury, commons, officialToken, purse } = await loadCommonsPageData();

  return (
    <article className="place commons">
      <PagePulse intervalMs={WORLD_PULSE_COMMONS_MS} />
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
                <br />
                the purse is finite $FENN under fenn&apos;s keeping.
              </p>
            </>
          }
        />
      </header>

      <div className="commons-sheet" aria-label="treasury and commons accounts">
        <TreasuryReadout treasury={treasury} />
        <FennTokenIdentity />
        <OfficialFennContract token={officialToken} variant="commons" />
        <PurseReadout purse={purse} officialTokenResolved={officialToken != null} />
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
