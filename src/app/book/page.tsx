import type { Metadata } from "next";
import Link from "next/link";

import { BOOK_ENTRIES } from "@/content/book";

export const metadata: Metadata = {
  title: "The Book",
};

export default function BookPage() {
  return (
    <article className="place book">
      <h1 className="place__title">THE BOOK</h1>
      <div className="place__body">
        <p className="muted">pages accumulate slowly.</p>
        <p className="muted">not everything here explains itself.</p>

        <nav className="book-index" aria-label="book entries">
          <ul>
            {BOOK_ENTRIES.map((entry) => (
              <li key={entry.id}>
                <a href={`#${entry.id}`}>[ {entry.title} ]</a>
              </li>
            ))}
            <li>
              <a
                href="https://x.com/askfenn"
                target="_blank"
                rel="noopener noreferrer"
              >
                [ ask fenn ]
              </a>
            </li>
            <li>
              <Link href="/oak">[ the oak ]</Link>
            </li>
          </ul>
        </nav>

        {BOOK_ENTRIES.map((entry) => (
          <section
            key={entry.id}
            id={entry.id}
            className="book-entry"
            aria-labelledby={`${entry.id}-title`}
          >
            <h2 id={`${entry.id}-title`} className="book-entry__title">
              {entry.title}
            </h2>
            <pre className="ascii book-entry__body">{entry.body}</pre>
          </section>
        ))}

        <section className="book-entry" aria-label="chronicle">
          <h2 className="book-entry__title">chronicle</h2>
          <p className="muted">pages not yet written.</p>
        </section>
      </div>
    </article>
  );
}
