import type { Metadata } from "next";

import { DeskGatheringsBoard } from "@/components/desk/desk-gatherings-board";

export const metadata: Metadata = {
  title: "GATHERINGS",
};

export default function DeskGatheringsPage() {
  return <DeskGatheringsBoard />;
}
