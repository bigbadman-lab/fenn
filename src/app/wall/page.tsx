import type { Metadata } from "next";

import { WallInscriptions } from "@/components/wall/wall-inscriptions";
import { AsciiPageTitle } from "@/components/ui/ascii-page-title";
import { WallError } from "@/lib/wall/errors";
import { listPublicWallEntries } from "@/lib/wall/read";
import type { PublicWallEntry } from "@/lib/wall/types";

export const metadata: Metadata = {
  title: "The Wall",
};

export const dynamic = "force-dynamic";

type WallPageData =
  | { state: "ready"; entries: PublicWallEntry[] }
  | { state: "unavailable" };

async function loadWallPageData(): Promise<WallPageData> {
  try {
    const entries = await listPublicWallEntries();
    return { state: "ready", entries };
  } catch (error) {
    if (error instanceof WallError) {
      console.error("[wall page]", error.code);
    } else {
      console.error("[wall page]", error);
    }
    return { state: "unavailable" };
  }
}

/**
 * Public Wall — FENN inscriptions only.
 * Marks are acknowledgement (Stage 10.5.3). No composer / comments / X / RAG.
 */
export default async function WallPage() {
  const data = await loadWallPageData();

  return (
    <article className="place wall">
      <header className="wall__header">
        <AsciiPageTitle
          title="THE WALL"
          mark="WALL"
          accent="wall"
          subtitle={
            <>
              <p className="wall__lede">only fenn writes here.</p>
              <p className="wall__aside muted">
                the road passes close enough to read it.
              </p>
            </>
          }
        />
      </header>

      {data.state === "unavailable" ? (
        <p className="wall-unavailable">the wall cannot be read just now.</p>
      ) : (
        <WallInscriptions
          key={data.entries.map((entry) => entry.id).join(",")}
          entries={data.entries}
        />
      )}
    </article>
  );
}
