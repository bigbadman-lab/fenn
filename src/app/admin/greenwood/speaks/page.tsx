import type { Metadata } from "next";

import { AdminSpeaksBoard } from "@/components/admin/admin-speaks-board";

export const metadata: Metadata = {
  title: "ADMIN · SPEAKS",
};

export default function AdminGreenwoodSpeaksPage() {
  return (
    <article className="place deeds-place">
      <AdminSpeaksBoard />
    </article>
  );
}
