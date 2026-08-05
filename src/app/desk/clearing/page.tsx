import type { Metadata } from "next";

import { DeskClearingPanel } from "@/components/desk/desk-clearing-panel";

export const metadata: Metadata = {
  title: "THE CLEARING",
};

export default function DeskClearingPage() {
  return <DeskClearingPanel />;
}
