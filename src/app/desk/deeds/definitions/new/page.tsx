import type { Metadata } from "next";

import { DeskDeedDefinitionPanel } from "@/components/desk/desk-deed-definition-panel";
import { DeskDeedsWorkspaceNav } from "@/components/desk/desk-deeds-workspace-nav";

export const metadata: Metadata = {
  title: "WRITE A DEED",
};

export default function DeskNewDeedPage() {
  return (
    <>
      <DeskDeedsWorkspaceNav activeView="definitions" />
      <DeskDeedDefinitionPanel />
    </>
  );
}
