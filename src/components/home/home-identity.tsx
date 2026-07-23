import { FennWorldMap } from "@/components/home/fenn-world-map";

export function HomeIdentity() {
  return (
    <section className="home-section home-identity" aria-labelledby="home-fenn">
      <h1 id="home-fenn" className="visually-hidden">
        FENN
      </h1>
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
