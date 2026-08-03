import type { Metadata } from "next";

import { DeskHollowBoard } from "@/components/desk/desk-hollow-board";

export const metadata: Metadata = {
  title: "THE HOLLOW",
};

export default function DeskHollowPage() {
  return <DeskHollowBoard />;
}
