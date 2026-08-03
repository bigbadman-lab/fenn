import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DeskDeedDetailPanel } from "@/components/desk/desk-deed-detail-panel";
import { DeskDeedsWorkspaceNav } from "@/components/desk/desk-deeds-workspace-nav";

export const metadata: Metadata = {
  title: "DEED SUBMISSION",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PageProps = { params: Promise<{ submissionId: string }> };

export default async function DeskDeedSubmissionPage({ params }: PageProps) {
  const { submissionId } = await params;
  // Block static segments (e.g. "definitions") from soft-landing as submissions.
  if (!UUID_RE.test(submissionId)) {
    notFound();
  }
  return (
    <>
      <DeskDeedsWorkspaceNav activeView="submissions" />
      <DeskDeedDetailPanel submissionId={submissionId} />
    </>
  );
}
