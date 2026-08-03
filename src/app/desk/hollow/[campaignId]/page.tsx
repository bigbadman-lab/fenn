import type { Metadata } from "next";

import { DeskHollowDetailPanel } from "@/components/desk/desk-hollow-detail-panel";

export const metadata: Metadata = {
  title: "HOLLOW CAMPAIGN",
};

type PageProps = { params: Promise<{ campaignId: string }> };

export default async function DeskHollowCampaignPage({ params }: PageProps) {
  const { campaignId } = await params;
  return <DeskHollowDetailPanel campaignId={campaignId} />;
}
