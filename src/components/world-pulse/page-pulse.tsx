"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

import { usePagePulse } from "@/hooks/use-page-pulse";

type PagePulseProps = {
  intervalMs: number;
  enabled?: boolean;
};

/**
 * Invisible client pulse: router.refresh() on an interval while the tab is visible.
 * Renders nothing. One instance per page.
 *
 * For `/commons`, this re-runs the RSC tree (force-dynamic) so
 * loadCommonsPageData → getPublicTreasurySnapshot executes live RPC again.
 * Does not call the chain from the browser. Never invents balances.
 */
export function PagePulse({ intervalMs, enabled = true }: PagePulseProps) {
  const router = useRouter();
  const onPulse = useCallback(() => {
    router.refresh();
  }, [router]);

  usePagePulse({
    intervalMs,
    enabled,
    onPulse,
    refreshOnVisible: true,
  });

  return null;
}
