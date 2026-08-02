import type { Metadata } from "next";

import { DeskSpeaksPanel } from "@/components/desk/desk-speaks-panel";

export const metadata: Metadata = {
  title: "FENN SPEAKS | THE DESK | FENN",
  robots: { index: false, follow: false },
};

export default function DeskSpeaksPage() {
  return <DeskSpeaksPanel />;
}
