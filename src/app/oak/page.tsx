import type { Metadata } from "next";
import Link from "next/link";

import { AsciiPageTitle } from "@/components/ui/ascii-page-title";
import {
  OAK_ASCII,
  OAK_DISTINCTION,
  OAK_LEDE,
  OAK_SECTIONS,
} from "@/content/oak";
import { buildPublicMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = buildPublicMetadata({
  title: "THE OAK",
  description:
    "What is true here. Doctrine, memory and the laws beneath the wood.",
  path: "/oak",
});

export default function OakPage() {
  return (
    <article className="place oak">
      <AsciiPageTitle
        title="THE OAK"
        mark="OAK"
        accent="oak"
        subtitle={
          <>
            <p className="muted">{OAK_LEDE}</p>
            <pre className="ascii oak-distinction muted">{OAK_DISTINCTION}</pre>
          </>
        }
      />

      <div className="place__body">
        <pre className="ascii oak-mark" aria-hidden="true">
          {OAK_ASCII}
        </pre>

        <nav className="oak-index" aria-label="oak rings">
          <ul>
            {OAK_SECTIONS.map((section) => (
              <li key={section.roman}>
                <a href={`#oak-${section.roman.toLowerCase()}`}>
                  [ {section.roman}. {section.title} ]
                </a>
              </li>
            ))}
            <li>
              <Link href="/book">[ the book — what happened ]</Link>
            </li>
          </ul>
        </nav>

        {OAK_SECTIONS.map((section) => (
          <section
            key={section.roman}
            id={`oak-${section.roman.toLowerCase()}`}
            className="oak-ring"
            aria-labelledby={`oak-${section.roman.toLowerCase()}-title`}
          >
            <h2
              id={`oak-${section.roman.toLowerCase()}-title`}
              className="oak-ring__title"
            >
              <span className="oak-ring__roman">{section.roman}.</span>{" "}
              {section.title}
            </h2>
            <pre className="ascii oak-ring__body">{section.body}</pre>
          </section>
        ))}
      </div>
    </article>
  );
}
