import type { Metadata } from "next";

import { DeskFirePanel } from "@/components/desk/desk-fire-panel";

export const metadata: Metadata = {
  title: "THE FIRE | THE DESK | FENN",
  robots: { index: false, follow: false },
};

export default function DeskFirePage() {
  return <DeskFirePanel />;
}
