import type { Metadata } from "next";

import { DeskDeedsWorkspace } from "@/components/desk/desk-deeds-workspace";
import { parseDeskDeedsView } from "@/lib/desk/deeds-view";

export const metadata: Metadata = {
  title: "DEEDS",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ view?: string | string[] }>;
};

/**
 * Deeds entry: definitions by default; submissions queue when view=submissions.
 * Selection is server-driven so the workspace is never “stuck” on the old queue-only UI.
 */
export default async function DeskDeedsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const view = parseDeskDeedsView(params.view);
  return <DeskDeedsWorkspace view={view} />;
}
