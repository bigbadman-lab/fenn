import type { Metadata } from "next";
import { Suspense } from "react";

import { GreenwoodGateway } from "@/components/greenwood/greenwood-gateway";
import { AsciiPageTitle } from "@/components/ui/ascii-page-title";
import { buildPublicMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = buildPublicMetadata({
  title: "THE GREENWOOD",
  description: "The path is free to see. Entry is earned.",
  path: "/greenwood",
});

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
