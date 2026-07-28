import type { Metadata } from "next";
import Link from "next/link";

import { AsciiPageTitle } from "@/components/ui/ascii-page-title";
import {
  chronicleEntryHeading,
  chronicleKindLabel,
  listPublicChronicleEntries,
} from "@/lib/chronicle";
import { ChronicleError } from "@/lib/chronicle/errors";
import type { PublicChronicleEntry } from "@/lib/chronicle/types";

export const metadata: Metadata = {
  title: "The Book",
};

export const dynamic = "force-dynamic";

async function loadEntries(): Promise<{
  entries: PublicChronicleEntry[];
  error: string | null;
}> {
  try {
    const entries = await listPublicChronicleEntries();
    return { entries, error: null };
  } catch (error) {
    const message =
      error instanceof ChronicleError
        ? "the book cannot be read just now"
        : "the book cannot be read just now";
    return { entries: [], error: message };
  }
}

export default async function BookPage() {
  const { entries, error } = await loadEntries();

  return (
    <article className="place book">
      <AsciiPageTitle
        title="THE BOOK"
        mark="BOOK"
        accent="book"
        subtitle={
          <>
            <p className="muted">A record of what happened here.</p>
            <pre className="ascii book-distinction muted">
              {`THE BOOK holds what happened.
THE OAK holds what is true.`}
            </pre>
          </>
        }
      />

      <div className="place__body">
        <nav className="book-index" aria-label="book">
          <ul>
            <li>
              <Link href="/oak">[ the oak — what is true ]</Link>
            </li>
            <li>
              <a
                href="https://x.com/askfenn"
                target="_blank"
                rel="noopener noreferrer"
              >
                [ ask fenn ]
              </a>
            </li>
          </ul>
        </nav>

        {error ? (
          <p className="muted book-empty">{error}</p>
        ) : entries.length === 0 ? (
          <p className="muted book-empty">pages not yet written.</p>
        ) : (
          entries.map((entry) => (
            <section
              key={entry.id}
              id={entry.id}
              className="book-entry"
              aria-labelledby={`${entry.id}-title`}
            >
              <p className="book-entry__date muted">
                {chronicleEntryHeading(entry)}
                <span className="book-entry__kind">
                  {" "}
                  · {chronicleKindLabel(entry)}
                </span>
              </p>
              {entry.title ? (
                <h2 id={`${entry.id}-title`} className="book-entry__title">
                  {entry.title}
                </h2>
              ) : (
                <h2 id={`${entry.id}-title`} className="visually-hidden">
                  entry
                </h2>
              )}
              <pre className="ascii book-entry__body">{entry.body}</pre>
            </section>
          ))
        )}
      </div>
    </article>
  );
}
