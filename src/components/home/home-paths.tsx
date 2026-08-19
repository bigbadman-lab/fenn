import Link from "next/link";

import { CANOPY_DISPLAY } from "@/lib/site/world-vocabulary";

type DirectoryTone =
  | "camp"
  | "deeds"
  | "greenwood"
  | "book"
  | "commons"
  | "ledger"
  | "oak"
  | "wall";

type DirectoryEntry = {
  number: string;
  label: string;
  href: string;
  tone: DirectoryTone;
  note: string;
  featured?: boolean;
};

const DIRECTORY: DirectoryEntry[] = [
  {
    number: "01",
    label: "the camp",
    href: "/camp",
    tone: "camp",
    note: "the fire is low.",
  },
  {
    number: "02",
    label: "deeds",
    href: "/deeds",
    tone: "deeds",
    note: "work waits.",
  },
  {
    number: "03",
    label: "the canopy",
    href: "/greenwood?crossing=1",
    tone: "greenwood",
    note: "the road continues upward.",
    featured: true,
  },
  {
    number: "04",
    label: "the book",
    href: "/book",
    tone: "book",
    note: "knowledge kept in the open.",
  },
  {
    number: "05",
    label: "the commons",
    href: "/commons",
    tone: "commons",
    note: "what may move.",
  },
  {
    number: "06",
    label: "the ledger",
    href: "/ledger",
    tone: "ledger",
    note: "what moved remains.",
  },
  {
    number: "07",
    label: "the oak",
    href: "/oak",
    tone: "oak",
    note: "it was here before you.",
  },
  {
    number: "08",
    label: "the wall",
    href: "/wall",
    tone: "wall",
    note: "only vell writes here.",
  },
];

/**
 * Homepage bottom navigation — VELL directory index.
 */
export function HomePaths() {
  return (
    <section
      className="home-section home-paths vell-dir"
      aria-labelledby="vell-dir-title"
    >
      <header className="vell-dir__head">
        <p className="vell-dir__kicker" aria-hidden="true">
          VELL // DIRECTORY
        </p>
        <h2 id="vell-dir-title" className="vell-dir__title">
          START WHEREVER YOU LIKE
        </h2>
      </header>

      <nav className="vell-dir__grid" aria-label="directory">
        {DIRECTORY.map((entry) => (
          <Link
            key={entry.href}
            href={entry.href}
            className={[
              "vell-dir__entry",
              `vell-dir__entry--${entry.tone}`,
              entry.featured ? "vell-dir__entry--featured" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="vell-dir__num" aria-hidden="true">
              {entry.number}
            </span>
            <span className="vell-dir__label">{entry.label}</span>
            <span className="vell-dir__note">{entry.note}</span>
          </Link>
        ))}
      </nav>

      <div className="vell-dir__prompt" aria-label="contact">
        <span className="vell-dir__prompt-prefix" aria-hidden="true">
          &gt;
        </span>
        <a
          href="https://x.com/thisisvell"
          className="vell-dir__prompt-link"
          target="_blank"
          rel="noopener noreferrer"
        >
          ask vell
        </a>
        <span className="vell-dir__cursor" aria-hidden="true">
          _
        </span>
      </div>

      <aside className="vell-dir__leaf" aria-label="leaf record">
        <p className="vell-dir__leaf-label" aria-hidden="true">
          LEAF RECORD
        </p>
        <p className="vell-dir__leaf-copy">
          LEAF measures what you gave {CANOPY_DISPLAY.the}.
          <br />
          It does not promise what {CANOPY_DISPLAY.the} will give you back.
        </p>
      </aside>
    </section>
  );
}
