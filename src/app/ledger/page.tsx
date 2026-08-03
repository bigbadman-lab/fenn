import type { Metadata } from "next";
import Link from "next/link";

import { LedgerRegister } from "@/components/ledger/ledger-register";
import { AsciiPageTitle } from "@/components/ui/ascii-page-title";
import { PagePulse } from "@/components/world-pulse/page-pulse";
import { loadLedgerPageData } from "@/lib/ledger/page-data";
import { buildPublicMetadata } from "@/lib/site/metadata";
import { WORLD_PULSE_LEDGER_MS } from "@/lib/world-pulse/intervals";

export const metadata: Metadata = buildPublicMetadata({
  title: "THE LEDGER",
  description: "Recognition accumulates here. Every LEAF has a source.",
  path: "/ledger",
});

export const dynamic = "force-dynamic";

type LedgerPageProps = {
  searchParams: Promise<{ before?: string; id?: string }>;
};

/**
 * Public LEAF recognition register.
 * LEAF is FENN's record that something mattered — not money, not XP.
 */
export default async function LedgerPage({ searchParams }: LedgerPageProps) {
  const params = await searchParams;
  const cursor =
    typeof params.before === "string" &&
    params.before.length > 0 &&
    typeof params.id === "string" &&
    params.id.length > 0
      ? { createdAt: params.before, id: params.id }
      : null;

  const data = await loadLedgerPageData({ cursor });

  const olderHref =
    data.state === "ready" && data.nextCursor
      ? `/ledger?before=${encodeURIComponent(data.nextCursor.createdAt)}&id=${encodeURIComponent(data.nextCursor.id)}`
      : null;

  return (
    <article className="place ledger">
      <PagePulse intervalMs={WORLD_PULSE_LEDGER_MS} />
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
              <p className="ledger__lede">
                FENN&apos;s record that something mattered.
              </p>
              <p className="ledger__aside muted">
                recognition accumulates as standing.
                <br />
                it is not spent. it is not money.
              </p>
            </>
          }
        />
      </header>

      <LedgerRegister data={data} olderHref={olderHref} />

      <nav className="ledger__nav" aria-label="related">
        <Link href="/commons">[ return to the commons ]</Link>
      </nav>
    </article>
  );
}
