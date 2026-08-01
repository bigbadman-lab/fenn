import type { Metadata } from "next";

import { AdminGatheringsBoard } from "@/components/admin/admin-gatherings-board";

export const metadata: Metadata = {
  title: "Admin · Greenwood Gatherings",
  robots: { index: false, follow: false },
};

/**
 * Minimal Gathering operations desk.
 * Authorization enforced by admin APIs (requireFennAdmin).
 */
export default function AdminGreenwoodGatheringsPage() {
  return (
    <article className="place deeds-place">
      <AdminGatheringsBoard />
    </article>
  );
}
