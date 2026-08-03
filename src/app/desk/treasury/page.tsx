import type { Metadata } from "next";

import { DeskTreasuryPanel } from "@/components/desk/desk-treasury-panel";

export const metadata: Metadata = {
  title: "THE TREASURY",
};

export default function DeskTreasuryPage() {
  return <DeskTreasuryPanel />;
}
