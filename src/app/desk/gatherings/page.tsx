import type { Metadata } from "next";

import { DeskGatheringsBoard } from "@/components/desk/desk-gatherings-board";

export const metadata: Metadata = {
  title: "GATHERINGS | THE DESK | FENN",
  robots: { index: false, follow: false },
};

export default function DeskGatheringsPage() {
  return <DeskGatheringsBoard />;
}
