import { CANONICAL_WELCOME_TEXT } from "@/content/welcome";

/**
 * Post-map Fenn voice — the full canonical welcome, discovered after the map.
 */
export function HomeFennVoice() {
  return (
    <section className="home-section home-fenn-voice" aria-label="i'm fenn">
      <pre className="ascii home-fenn-voice__text">{CANONICAL_WELCOME_TEXT}</pre>
    </section>
  );
}
