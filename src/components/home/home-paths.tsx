import Link from "next/link";

const PATHS = [
  { href: "/camp", label: "the camp" },
  { href: "/deeds", label: "deeds" },
  { href: "/greenwood?crossing=1", label: "the greenwood" },
  { href: "/book", label: "the book" },
  { href: "/commons", label: "the commons" },
  { href: "/ledger", label: "the ledger" },
  {
    href: "https://x.com/askfenn",
    label: "ask fenn",
    external: true,
  },
  { href: "/oak", label: "the oak" },
] as const;

export function HomePaths() {
  return (
    <section className="home-section home-paths" aria-label="paths">
      <ul className="home-paths__list">
        {PATHS.map((item) => {
          const label = `[ ${item.label} ]`;
          if ("external" in item && item.external) {
            return (
              <li key={item.href}>
                <a
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {label}
                </a>
              </li>
            );
          }
          return (
            <li key={item.href}>
              <Link href={item.href}>{label}</Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
