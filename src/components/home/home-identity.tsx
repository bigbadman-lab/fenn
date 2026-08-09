import { FennWorldMap } from "@/components/home/fenn-world-map";
import { HomeOfficialContract } from "@/components/home/home-official-contract";
import { HOMEPAGE_MAP_ORIENTATION } from "@/lib/home/homepage-audience";

/**
 * World / map section: orientation, official $FENN contract (trust surface),
 * then the geographic map. Contract sits above the map so verification is
 * early and independent of deep lore / directory.
 */
export async function HomeIdentity() {
  return (
    <section className="home-section home-identity" aria-labelledby="home-fenn">
      <h1 id="home-fenn" className="visually-hidden">
        FENN
      </h1>

      <header className="home-world-orient" aria-labelledby="home-world-title">
        <h2 id="home-world-title" className="home-world-orient__title">
          {HOMEPAGE_MAP_ORIENTATION.title}
        </h2>
        <div className="home-world-orient__body">
          {HOMEPAGE_MAP_ORIENTATION.lines.map((line) => (
            <p key={line} className="home-world-orient__line">
              {line}
            </p>
          ))}
        </div>
      </header>

      <HomeOfficialContract />

      <FennWorldMap />
      <p className="home-identity__line">
        What the Crown keeps,
        <br />
        the Greenwood shares.
      </p>
      <p className="home-identity__aside muted">i live in the greenwood.</p>
    </section>
  );
}
