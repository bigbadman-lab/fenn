import type { Metadata } from "next";

import { DeskDeedsBoard } from "@/components/desk/desk-deeds-board";

export const metadata: Metadata = {
  title: "DEEDS",
};

export default function DeskDeedsPage() {
  return <DeskDeedsBoard />;
}
