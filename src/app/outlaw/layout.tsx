import type { Metadata } from "next";

import { buildPrivateMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = buildPrivateMetadata("YOUR OUTLAW");

export default function OutlawLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
