"use client";

import Link from "next/link";
import { useEffect } from "react";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

/**
 * Restrained recovery surface. Diagnostics stay in the console only.
 * Client errors cannot set robots metadata; global noindex covers previews.
 */
export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error("[fenn/error]", error.digest ?? error.message);
  }, [error]);

  return (
    <article className="place">
      <h1 className="ascii-page-title__h1">SOMETHING WENT WRONG</h1>
      <p className="muted">The path failed underfoot. Try again, or return.</p>
      <p>
        <button type="button" onClick={() => reset()}>
          [ TRY AGAIN ]
        </button>
      </p>
      <p>
        <Link href="/">[ RETURN TO VELL ]</Link>
      </p>
    </article>
  );
}
