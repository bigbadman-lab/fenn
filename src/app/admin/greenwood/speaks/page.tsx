import type { Metadata } from "next";

import { AdminSpeaksBoard } from "@/components/admin/admin-speaks-board";

export const metadata: Metadata = {
  title: "Admin · FENN SPEAKS",
  robots: { index: false, follow: false },
};

export default function AdminGreenwoodSpeaksPage() {
  return (
    <article className="place deeds-place">
      <AdminSpeaksBoard />
    </article>
  );
}
