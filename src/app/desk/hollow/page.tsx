import type { Metadata } from "next";

import { DeskHollowBoard } from "@/components/desk/desk-hollow-board";

export const metadata: Metadata = {
  title: "THE HOLLOW | THE DESK | FENN",
  robots: { index: false, follow: false },
};

export default function DeskHollowPage() {
  return <DeskHollowBoard />;
}
