import type { Metadata } from "next";

import { DeskRegisterMemberPanel } from "@/components/desk/desk-register-member-panel";

export const metadata: Metadata = {
  title: "MEMBER",
};

type PageProps = {
  params: Promise<{ profileId: string }>;
};

export default async function DeskRegisterMemberPage({ params }: PageProps) {
  const { profileId } = await params;
  return <DeskRegisterMemberPanel profileId={profileId} />;
}
