import type { Metadata } from "next";

import { DeskHollowDetailPanel } from "@/components/desk/desk-hollow-detail-panel";

export const metadata: Metadata = {
  title: "HOLLOW CAMPAIGN | THE DESK | FENN",
  robots: { index: false, follow: false },
};

type PageProps = { params: Promise<{ campaignId: string }> };

export default async function DeskHollowCampaignPage({ params }: PageProps) {
  const { campaignId } = await params;
  return <DeskHollowDetailPanel campaignId={campaignId} />;
}
