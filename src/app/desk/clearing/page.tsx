import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DeskClearingPanel } from "@/components/desk/desk-clearing-panel";
import { CLEARING_DESK_SURFACE_ENABLED } from "@/lib/clearing/visibility";

export const metadata: Metadata = CLEARING_DESK_SURFACE_ENABLED
  ? { title: "THE CLEARING" }
  : { title: "Not found", robots: { index: false, follow: false } };

export default function DeskClearingPage() {
  if (!CLEARING_DESK_SURFACE_ENABLED) {
    notFound();
  }
  return <DeskClearingPanel />;
}
