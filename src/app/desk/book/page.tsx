import type { Metadata } from "next";

import { DeskBookPanel } from "@/components/desk/desk-book-panel";

export const metadata: Metadata = {
  title: "THE BOOK | THE DESK | FENN",
  robots: { index: false, follow: false },
};

export default function DeskBookPage() {
  return <DeskBookPanel />;
}
