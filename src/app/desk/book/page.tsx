import type { Metadata } from "next";

import { DeskBookPanel } from "@/components/desk/desk-book-panel";

export const metadata: Metadata = {
  title: "THE BOOK",
};

export default function DeskBookPage() {
  return <DeskBookPanel />;
}
