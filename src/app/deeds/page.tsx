import type { Metadata } from "next";

import { DeedBoard } from "@/components/deeds/deed-board";
import { AsciiPageTitle } from "@/components/ui/ascii-page-title";
import { listPublicDeeds } from "@/lib/deeds/queries";

export const metadata: Metadata = {
  title: "Deeds",
};

export const dynamic = "force-dynamic";

export default async function DeedsPage() {
  const deeds = await listPublicDeeds();

  return (
    <article className="place deeds-place">
      <AsciiPageTitle
        title="DEEDS"
        mark="DEEDS"
        accent="deeds"
        subtitle={
          deeds.length === 0 ? (
            <>
              <p>the board is empty.</p>
              <p className="muted">work will appear here.</p>
            </>
          ) : (
            <div className="deed-board__header">
              <p className="deed-board__header-title">THE BOARD</p>
              <p className="muted">work left in the open.</p>
              <p className="muted">take what you can finish.</p>
            </div>
          )
        }
      />

      {deeds.length > 0 ? (
        <section className="deed-board" aria-labelledby="deed-board-list-title">
          <h2 id="deed-board-list-title" className="visually-hidden">
            Posted deeds
          </h2>
          <DeedBoard deeds={deeds} />
        </section>
      ) : null}
    </article>
  );
}
