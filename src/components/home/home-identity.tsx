import { FennWorldMap } from "@/components/home/fenn-world-map";
import {
  HOMEPAGE_MAP_EPILOGUE,
  HOMEPAGE_MAP_ORIENTATION,
} from "@/lib/home/homepage-audience";

/**
 * World / map section: orientation, then the geographic map.
 */
export function HomeIdentity() {
  return (
    <section className="home-section home-identity" aria-labelledby="home-fenn">
      <h1 id="home-fenn" className="visually-hidden">
        VELL
      </h1>

      <header className="home-map-preface" aria-labelledby="home-world-title">
        <p id="home-world-title" className="home-map-preface__label">
          {HOMEPAGE_MAP_ORIENTATION.title}
        </p>
        <ol className="home-map-preface__steps">
          {HOMEPAGE_MAP_ORIENTATION.lines.map((line, index) => (
            <li key={line} className="home-map-preface__step">
              <span className="home-map-preface__num" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="home-map-preface__text">{line}</span>
            </li>
          ))}
        </ol>
      </header>

      <FennWorldMap />
      <p className="home-identity__line">{HOMEPAGE_MAP_EPILOGUE.line}</p>
      <p className="home-identity__aside muted">{HOMEPAGE_MAP_EPILOGUE.aside}</p>
    </section>
  );
}
