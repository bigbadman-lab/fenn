import { HOMEPAGE_WELCOME } from "@/content/welcome";

/**
 * Compact arrival transmission above the map.
 * Map remains the primary visual event.
 */
export function HomeWelcome() {
  return (
    <section className="home-section home-welcome" aria-label="welcome">
      <h2 className="home-welcome__title">{HOMEPAGE_WELCOME.title}</h2>

      <div className="home-welcome__body">
        {HOMEPAGE_WELCOME.lines.map((line) => (
          <p key={line} className="home-welcome__line">
            {line}
          </p>
        ))}
      </div>

      <div className="home-welcome__body">
        {HOMEPAGE_WELCOME.deeds.map((line) => (
          <p key={line} className="home-welcome__line">
            {line}
          </p>
        ))}
      </div>

      <p className="home-welcome__closing">{HOMEPAGE_WELCOME.closing}</p>

      <p className="home-welcome__cta">
        <a href="#the-map" className="home-welcome__enter">
          {HOMEPAGE_WELCOME.enter}
        </a>
      </p>
    </section>
  );
}
