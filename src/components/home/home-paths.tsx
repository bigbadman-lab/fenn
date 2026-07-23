import Link from "next/link";

type DirectoryTone =
  | "camp"
  | "deeds"
  | "greenwood"
  | "book"
  | "commons"
  | "ledger"
  | "oak";

type DirectoryEntry = {
  number: string;
  label: string;
  href: string;
  tone: DirectoryTone;
  note: string;
  region: "camp" | "greenwood" | "deeds" | "commons" | "ledger" | "book" | "oak";
};

const DIRECTORY: DirectoryEntry[] = [
  {
    number: "01",
    label: "the camp",
    href: "/camp",
    tone: "camp",
    note: "the fire is low.",
    region: "camp",
  },
  {
    number: "02",
    label: "deeds",
    href: "/deeds",
    tone: "deeds",
    note: "work waits.",
    region: "deeds",
  },
  {
    number: "03",
    label: "the greenwood",
    href: "/greenwood?crossing=1",
    tone: "greenwood",
    note: "the road continues.",
    region: "greenwood",
  },
  {
    number: "04",
    label: "the book",
    href: "/book",
    tone: "book",
    note: "knowledge kept in the open.",
    region: "book",
  },
  {
    number: "05",
    label: "the commons",
    href: "/commons",
    tone: "commons",
    note: "what may move.",
    region: "commons",
  },
  {
    number: "06",
    label: "the ledger",
    href: "/ledger",
    tone: "ledger",
    note: "what moved remains.",
    region: "ledger",
  },
  {
    number: "07",
    label: "the oak",
    href: "/oak",
    tone: "oak",
    note: "it was here before you.",
    region: "oak",
  },
];

const GREENWOOD_ASCII = `  ^^  Y  ^^^  Y
^^^   [|||]   ^^^
 Y    [|||]    Y`;

function DirectoryCell({ entry }: { entry: DirectoryEntry }) {
  const isGreenwood = entry.region === "greenwood";

  return (
    <div
      className={`old-dir__cell old-dir__cell--${entry.region} old-dir__cell--${entry.tone}`}
    >
      <span className="old-dir__num" aria-hidden="true">
        {entry.number}
      </span>
      <Link
        href={entry.href}
        className={`old-dir__link old-dir__link--${entry.tone}`}
      >
        [ {entry.label} ]
      </Link>
      {isGreenwood ? (
        <pre className="ascii old-dir__forest" aria-hidden="true">
          {GREENWOOD_ASCII}
        </pre>
      ) : null}
      <p className="old-dir__note">{entry.note}</p>
    </div>
  );
}

/**
 * Homepage bottom navigation — THE OLD DIRECTORY.
 * One hard-edged terminal panel; irregular inner partitions.
 */
export function HomePaths() {
  const byRegion = Object.fromEntries(
    DIRECTORY.map((entry) => [entry.region, entry]),
  ) as Record<DirectoryEntry["region"], DirectoryEntry>;

  return (
    <section
      className="home-section home-paths old-dir"
      aria-labelledby="old-dir-title"
    >
      <div className="old-dir__panel">
        <header className="old-dir__head">
          <h2 id="old-dir-title" className="old-dir__title">
            START WHEREVER YOU LIKE
          </h2>
          <p className="old-dir__mark" aria-hidden="true">
            FENN // DIRECTORY
          </p>
        </header>

        <div className="old-dir__body" role="navigation" aria-label="directory">
          <DirectoryCell entry={byRegion.camp} />
          <DirectoryCell entry={byRegion.greenwood} />
          <DirectoryCell entry={byRegion.deeds} />
          <DirectoryCell entry={byRegion.commons} />
          <DirectoryCell entry={byRegion.ledger} />
          <DirectoryCell entry={byRegion.book} />
          <DirectoryCell entry={byRegion.oak} />
        </div>

        <div className="old-dir__ask">
          <span className="old-dir__ask-prefix" aria-hidden="true">
            &gt;
          </span>
          <a
            href="https://x.com/askfenn"
            className="old-dir__ask-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            ask fenn
          </a>
          <span className="old-dir__ask-cursor" aria-hidden="true">
            _
          </span>
        </div>

        <aside className="old-dir__leaf" aria-label="leaf record">
          <p className="old-dir__leaf-label" aria-hidden="true">
            LEAF RECORD
          </p>
          <p className="old-dir__leaf-copy">
            LEAF measures what you gave the Greenwood.
            <br />
            It does not promise what the Greenwood will give you back.
          </p>
        </aside>

        <div className="old-dir__foot" aria-hidden="true">
          <span className="old-dir__foot-left">└──</span>
          <span className="old-dir__foot-gap"> </span>
          <span className="old-dir__foot-right">──────────────┘</span>
        </div>
      </div>
    </section>
  );
}
