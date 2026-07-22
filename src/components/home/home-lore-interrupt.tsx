import { LORE_INTERRUPT_ASCII } from "@/content/home-ascii";

export function HomeLoreInterrupt() {
  return (
    <section className="home-section home-lore" aria-label="fragments">
      <pre className="ascii home-lore__mark" aria-hidden="true">
        {LORE_INTERRUPT_ASCII}
      </pre>
      <p className="muted">a hoard is a failure of circulation.</p>
      <p className="muted">the road is free. the greenwood is earned.</p>
    </section>
  );
}
