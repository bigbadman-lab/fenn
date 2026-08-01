import type { Metadata } from "next";

import { GreenwoodHollow } from "@/components/greenwood/greenwood-hollow";

export const metadata: Metadata = {
  title: "The Hollow",
  robots: { index: false, follow: false },
};

export default function GreenwoodHollowPage() {
  return <GreenwoodHollow />;
}
