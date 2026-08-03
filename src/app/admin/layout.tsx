import type { ReactNode } from "react";
import type { Metadata } from "next";

import { buildPrivateMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = buildPrivateMetadata("ADMIN");

/**
 * Shared operator shell for /admin/*.
 * Page authority remains in Admin APIs — layout noindex is crawl protection only.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
