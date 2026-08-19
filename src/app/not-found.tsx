import type { Metadata } from "next";
import Link from "next/link";

import { PRIVATE_ROBOTS } from "@/lib/site/metadata";

export const metadata: Metadata = {
  title: "NOT FOUND",
  robots: PRIVATE_ROBOTS,
};

export default function NotFound() {
  return (
    <article className="place">
      <h1 className="ascii-page-title__h1">NOT FOUND</h1>
      <p className="muted">The path does not continue here.</p>
      <p>
        <Link href="/">[ RETURN TO VELL ]</Link>
      </p>
    </article>
  );
}
