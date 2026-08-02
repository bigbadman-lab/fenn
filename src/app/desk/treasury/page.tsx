import type { Metadata } from "next";

import { DeskTreasuryPanel } from "@/components/desk/desk-treasury-panel";

export const metadata: Metadata = {
  title: "THE TREASURY | THE DESK | FENN",
  robots: { index: false, follow: false },
};

export default function DeskTreasuryPage() {
  return <DeskTreasuryPanel />;
}
