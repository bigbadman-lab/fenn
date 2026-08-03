import type { Metadata } from "next";

import { DeskRegisterBoard } from "@/components/desk/desk-register-board";

export const metadata: Metadata = {
  title: "THE REGISTER",
};

export default function DeskRegisterPage() {
  return <DeskRegisterBoard />;
}
