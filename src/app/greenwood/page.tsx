import type { Metadata } from "next";
import { Suspense } from "react";

import { GreenwoodGateway } from "@/components/greenwood/greenwood-gateway";
import { AsciiPageTitle } from "@/components/ui/ascii-page-title";
import { getConfiguredGreenwoodLifetimeThreshold } from "@/lib/leaf/standing";
import { buildPublicMetadata } from "@/lib/site/metadata";
import { CANOPY_DISPLAY } from "@/lib/site/world-vocabulary";

export const metadata: Metadata = buildPublicMetadata({
  title: CANOPY_DISPLAY.title,
  description: "The path is free to see. Entry is earned.",
  path: "/greenwood",
});

/** Threshold law is configuration — never invent a number at build time. */
export const dynamic = "force-dynamic";

function GreenwoodFallback() {
  return (
    <article className="place greenwood-gate">
      <AsciiPageTitle
        title={CANOPY_DISPLAY.title}
        mark={CANOPY_DISPLAY.mark}
        accent="greenwood"
        subtitle={<p className="muted">finding the path...</p>}
      />
    </article>
  );
}

export default async function GreenwoodPage() {
  let configuredThreshold: number | null = null;
  try {
    configuredThreshold = await getConfiguredGreenwoodLifetimeThreshold();
  } catch {
    configuredThreshold = null;
  }

  return (
    <Suspense fallback={<GreenwoodFallback />}>
      <GreenwoodGateway configuredThreshold={configuredThreshold} />
    </Suspense>
  );
}
