import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { VellXReplyTerminal } from "@/components/dev/vell-x-reply-terminal";
import { isDevOnlyFeatureAllowed } from "@/lib/dev/assert-dev-only";
import { PRIVATE_ROBOTS } from "@/lib/site/metadata";

export const metadata: Metadata = {
  title: "VELL X REPLY TERMINAL",
  robots: PRIVATE_ROBOTS,
};

export const dynamic = "force-dynamic";

/**
 * Local-only paste → VELL voice → copy terminal.
 * Inaccessible unless NODE_ENV/VERCEL_ENV are non-production and
 * VELL_DEV_X_REPLY_TERMINAL=1.
 */
export default function VellXReplyPage() {
  if (!isDevOnlyFeatureAllowed()) {
    notFound();
  }

  return (
    <main className="vell-x-reply-page">
      <VellXReplyTerminal />
    </main>
  );
}
