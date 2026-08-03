import type { Metadata } from "next";

import { DeskDeedDetailPanel } from "@/components/desk/desk-deed-detail-panel";

export const metadata: Metadata = {
  title: "DEED SUBMISSION",
};

type PageProps = { params: Promise<{ submissionId: string }> };

export default async function DeskDeedSubmissionPage({ params }: PageProps) {
  const { submissionId } = await params;
  return <DeskDeedDetailPanel submissionId={submissionId} />;
}
