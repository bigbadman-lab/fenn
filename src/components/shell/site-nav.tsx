"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/camp", label: "the camp" },
  { href: "/deeds", label: "deeds" },
  { href: "/greenwood", label: "the greenwood" },
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

export function SiteNav() {
  const pathname = usePathname();

  return (
    <nav className="site-nav" aria-label="FENN">
      <ul className="site-nav__list">
        {NAV_ITEMS.map((item) => {
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

          const isCurrent = pathname === item.href;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isCurrent ? "page" : undefined}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
