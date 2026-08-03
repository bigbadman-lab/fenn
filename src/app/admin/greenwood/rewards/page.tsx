import type { Metadata } from "next";

import { AdminRewardsBoard } from "@/components/admin/admin-rewards-board";

export const metadata: Metadata = {
  title: "ADMIN · REWARDS",
};

export default function AdminGreenwoodRewardsPage() {
  return (
    <article className="place deeds-place">
      <AdminRewardsBoard />
    </article>
  );
}
