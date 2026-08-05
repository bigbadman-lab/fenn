import type { Metadata } from "next";

import { DeskMarketWatchPanel } from "@/components/desk/desk-market-watch-panel";

export const metadata: Metadata = {
  title: "MARKET WATCH",
};

export default function DeskMarketWatchPage() {
  return <DeskMarketWatchPanel />;
}
