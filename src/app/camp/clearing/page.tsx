import type { Metadata } from "next";

import { ClearingPage } from "@/components/clearing/clearing-page";
import { buildPublicMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = buildPublicMetadata({
  title: "THE CLEARING",
  description:
    "Where Travellers and Outlaws gather to speak. Anyone may listen.",
  path: "/camp/clearing",
});

export default function CampClearingRoute() {
  return <ClearingPage />;
}
