import type { Metadata } from "next";

import { AdminDeedsBoard } from "@/components/admin/admin-deeds-board";

export const metadata: Metadata = {
  title: "Admin · Deeds",
  robots: { index: false, follow: false },
};

/**
 * Operational moderation desk — not a public world location.
 * Authorization is enforced by admin APIs (requireFennAdmin).
 */
export default function AdminDeedsPage() {
  return (
    <article className="place deeds-place">
      <AdminDeedsBoard />
    </article>
  );
}
