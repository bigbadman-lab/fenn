import type { Metadata } from "next";

import { DeskFirePanel } from "@/components/desk/desk-fire-panel";

export const metadata: Metadata = {
  title: "THE FIRE",
};

export default function DeskFirePage() {
  return <DeskFirePanel />;
}
