import type { ReactNode } from "react";
import type { Metadata } from "next";

import { DeskGate } from "@/components/desk/desk-gate";
import { buildPrivateMetadata } from "@/lib/site/metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = buildPrivateMetadata("THE DESK");

/**
 * Shared shell for /desk and future /desk/* pages.
 *
 * Page content is gated by DeskGate (session → requireFennDeskAccess).
 * Desk API routes MUST call requireFennDeskAccess independently — layout
 * protection is never API protection.
 */
export default function DeskLayout({ children }: { children: ReactNode }) {
  return (
    <article className="place desk-place" data-desk-root>
      <DeskGate>{children}</DeskGate>
    </article>
  );
}
