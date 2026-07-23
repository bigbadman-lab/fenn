import type { Metadata } from "next";

import { AsciiPageTitle } from "@/components/ui/ascii-page-title";
import { OAK_ASCII, OAK_FRAGMENTS } from "@/content/oak";

export const metadata: Metadata = {
  title: "The Oak",
};

export default function OakPage() {
  return (
    <article className="place">
      <AsciiPageTitle
        title="THE OAK"
        mark="OAK"
        accent="oak"
        subtitle={<p className="muted">a place with little immediate use.</p>}
      />
      <div className="place__body">
        <pre className="ascii oak-mark" aria-hidden="true">
          {OAK_ASCII}
        </pre>
        {OAK_FRAGMENTS.map((fragment) => (
          <pre key={fragment} className="ascii oak-fragment">
            {fragment}
          </pre>
        ))}
      </div>
    </article>
  );
}
