import { LORE_INTERRUPT_ASCII } from "@/content/home-ascii";

export function HomeLoreInterrupt() {
  return (
    <section className="home-section home-lore" aria-label="fragments">
      <pre className="ascii home-lore__mark" aria-hidden="true">
        {LORE_INTERRUPT_ASCII}
      </pre>
      <p className="muted">a hoard is a failure of circulation.</p>
      <p className="home-lore__offset muted">
        the road is free. the greenwood is earned.
      </p>
      <p className="home-lore__drift muted">
        The Treasury is where things arrive.
        <br />
        The Commons is what FENN has committed to move.
      </p>
      <p className="home-lore__aside muted">
        the man in the castle built a road.
        <br />
        he may not have expected us.
      </p>
    </section>
  );
}
