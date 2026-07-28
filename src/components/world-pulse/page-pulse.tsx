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
