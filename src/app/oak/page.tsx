import type { Metadata } from "next";

import { OAK_ASCII, OAK_FRAGMENTS } from "@/content/oak";

export const metadata: Metadata = {
  title: "The Oak",
};

export default function OakPage() {
  return (
    <article className="place">
      <h1 className="place__title">THE OAK</h1>
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
