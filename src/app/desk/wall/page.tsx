import type { Metadata } from "next";

import { DeskWallPanel } from "@/components/desk/desk-wall-panel";

export const metadata: Metadata = {
  title: "THE WALL",
};

export default function DeskWallPage() {
  return <DeskWallPanel />;
}
