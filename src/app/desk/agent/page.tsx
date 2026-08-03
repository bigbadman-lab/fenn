import type { Metadata } from "next";

import { DeskAgentPanel } from "@/components/desk/desk-agent-panel";

export const metadata: Metadata = {
  title: "THE AGENT",
};

export default function DeskAgentPage() {
  return <DeskAgentPanel />;
}
