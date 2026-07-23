import type { Metadata } from "next";

import { AsciiPageTitle } from "@/components/ui/ascii-page-title";

export const metadata: Metadata = {
  title: "Deeds",
};

export default function DeedsPage() {
  return (
    <article className="place">
      <AsciiPageTitle
        title="DEEDS"
        mark="DEEDS"
        accent="deeds"
        subtitle={
          <>
            <p>the board is empty.</p>
            <p className="muted">work will appear here.</p>
          </>
        }
      />
    </article>
  );
}
