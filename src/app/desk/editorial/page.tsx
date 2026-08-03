import type { Metadata } from "next";

import { DeskEditorialPanel } from "@/components/desk/desk-editorial-panel";

export const metadata: Metadata = {
  title: "THE EDITORIAL ROOM",
};

export default function DeskEditorialPage() {
  return <DeskEditorialPanel />;
}
