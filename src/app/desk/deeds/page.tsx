import type { Metadata } from "next";

import { DeskDeedsWorkspace } from "@/components/desk/desk-deeds-workspace";

export const metadata: Metadata = {
  title: "DEEDS",
};

export default function DeskDeedsPage() {
  return <DeskDeedsWorkspace />;
}
