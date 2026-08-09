import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ClearingPage } from "@/components/clearing/clearing-page";
import { CLEARING_PUBLIC_SURFACE_ENABLED } from "@/lib/clearing/visibility";
import { buildPublicMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = CLEARING_PUBLIC_SURFACE_ENABLED
  ? buildPublicMetadata({
      title: "THE CLEARING",
      description:
        "Where Travellers and Outlaws gather to speak. Anyone may listen.",
      path: "/camp/clearing",
    })
  : {
      title: "Not found",
      robots: { index: false, follow: false },
    };

export default function CampClearingRoute() {
  if (!CLEARING_PUBLIC_SURFACE_ENABLED) {
    notFound();
  }
  return <ClearingPage />;
}
