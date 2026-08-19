import type { Metadata } from "next";

import { DeskSpeaksPanel } from "@/components/desk/desk-speaks-panel";

export const metadata: Metadata = {
  title: "VELL SPEAKS",
};

export default function DeskSpeaksPage() {
  return <DeskSpeaksPanel />;
}
