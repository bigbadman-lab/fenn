import type { Metadata } from "next";

import { GreenwoodHollow } from "@/components/greenwood/greenwood-hollow";
import { buildPrivateMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = buildPrivateMetadata("THE HOLLOW");

export default function GreenwoodHollowPage() {
  return <GreenwoodHollow />;
}
