import { HOME_FENN_ASCII } from "@/content/home-ascii";

export function HomeIdentity() {
  return (
    <section className="home-section home-identity" aria-labelledby="home-fenn">
      <h1 id="home-fenn" className="visually-hidden">
        FENN
      </h1>
      <pre className="ascii home-identity__mark" aria-hidden="true">
        {HOME_FENN_ASCII}
      </pre>
      <p className="home-identity__line">
        What the Crown keeps,
        <br />
        the Greenwood shares.
      </p>
    </section>
  );
}
