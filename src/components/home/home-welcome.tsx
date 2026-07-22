import { CANONICAL_WELCOME_TEXT } from "@/content/welcome";

export function HomeWelcome() {
  return (
    <section className="home-section home-welcome" aria-label="welcome">
      <pre className="ascii home-welcome__text">{CANONICAL_WELCOME_TEXT}</pre>
    </section>
  );
}
