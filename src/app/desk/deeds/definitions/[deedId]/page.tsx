import type { Metadata } from "next";

import { DeskDeedDefinitionPanel } from "@/components/desk/desk-deed-definition-panel";
import { DeskDeedsWorkspaceNav } from "@/components/desk/desk-deeds-workspace-nav";

export const metadata: Metadata = {
  title: "DEED DEFINITION",
};

type PageProps = { params: Promise<{ deedId: string }> };

export default async function DeskDeedDefinitionPage({ params }: PageProps) {
  const { deedId } = await params;
  return (
    <>
      <DeskDeedsWorkspaceNav activeView="definitions" />
      <DeskDeedDefinitionPanel deedId={deedId} />
    </>
  );
}
