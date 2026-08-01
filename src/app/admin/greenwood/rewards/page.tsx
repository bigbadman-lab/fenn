import type { Metadata } from "next";

import { AdminRewardsBoard } from "@/components/admin/admin-rewards-board";

export const metadata: Metadata = {
  title: "Admin · Greenwood Rewards",
  robots: { index: false, follow: false },
};

export default function AdminGreenwoodRewardsPage() {
  return (
    <article className="place deeds-place">
      <AdminRewardsBoard />
    </article>
  );
}
