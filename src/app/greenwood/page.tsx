import type { Metadata } from "next";
import { Suspense } from "react";

import { GreenwoodGateway } from "@/components/greenwood/greenwood-gateway";
import { AsciiPageTitle } from "@/components/ui/ascii-page-title";

export const metadata: Metadata = {
  title: "The Greenwood",
};

function GreenwoodFallback() {
  return (
    <article className="place greenwood-gate">
      <AsciiPageTitle
        title="THE GREENWOOD"
        mark="GREENWOOD"
        accent="greenwood"
        subtitle={<p className="muted">finding the path...</p>}
      />
    </article>
  );
}

export default function GreenwoodPage() {
  return (
    <Suspense fallback={<GreenwoodFallback />}>
      <GreenwoodGateway />
    </Suspense>
  );
}
