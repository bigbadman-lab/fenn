import type { Metadata } from "next";

import { DeskAgentPanel } from "@/components/desk/desk-agent-panel";

export const metadata: Metadata = {
  title: "THE AGENT | THE DESK | FENN",
  robots: { index: false, follow: false },
};

export default function DeskAgentPage() {
  return <DeskAgentPanel />;
}
