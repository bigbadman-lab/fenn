import type { Metadata } from "next";

import { DeskRegisterBoard } from "@/components/desk/desk-register-board";

export const metadata: Metadata = {
  title: "THE REGISTER | THE DESK | FENN",
  robots: { index: false, follow: false },
};

export default function DeskRegisterPage() {
  return <DeskRegisterBoard />;
}
