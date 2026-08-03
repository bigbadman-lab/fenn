import type { Metadata } from "next";

import { DeskGatheringDetailPanel } from "@/components/desk/desk-gathering-detail-panel";

export const metadata: Metadata = {
  title: "GATHERING",
};

type PageProps = {
  params: Promise<{ gatheringId: string }>;
};

export default async function DeskGatheringDetailPage({ params }: PageProps) {
  const { gatheringId } = await params;
  return <DeskGatheringDetailPanel gatheringId={gatheringId} />;
}
