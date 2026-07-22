import type { Metadata } from "next";
import { Suspense } from "react";

import { GreenwoodGateway } from "@/components/greenwood/greenwood-gateway";

export const metadata: Metadata = {
  title: "The Greenwood",
};

function GreenwoodFallback() {
  return (
    <article className="place greenwood-gate">
      <h1 className="place__title">THE GREENWOOD</h1>
      <p className="muted">finding the path...</p>
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
