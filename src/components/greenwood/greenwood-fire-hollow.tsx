"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { usePagePulse } from "@/hooks/use-page-pulse";
import { fetchGreenwoodHollowStatus } from "@/lib/greenwood/client";
import { WORLD_PULSE_GREENWOOD_HOLLOW_MS } from "@/lib/world-pulse/intervals";

type Props = {
  getAuthHeaders: () => Promise<HeadersInit | null>;
};

/**
 * Living Greenwood 4 — restrained Hollow door at The Fire.
 * Does not invent a reward count before a successful authenticated read.
 */
export function GreenwoodFireHollow({ getAuthHeaders }: Props) {
  const [hasAvailable, setHasAvailable] = useState<boolean | null>(null);
  const headersRef = useRef(getAuthHeaders);

  useEffect(() => {
    headersRef.current = getAuthHeaders;
  }, [getAuthHeaders]);

  const refresh = useCallback(async () => {
    const headers = await headersRef.current();
    if (!headers) {
      setHasAvailable(null);
      return;
    }
    const result = await fetchGreenwoodHollowStatus(headers);
    if (!result.ok) {
      setHasAvailable(null);
      return;
    }
    setHasAvailable(result.status.hasAvailable);
  }, []);

  usePagePulse({
    intervalMs: WORLD_PULSE_GREENWOOD_HOLLOW_MS,
    onPulse: () => {
      void refresh();
    },
    enabled: true,
    refreshOnVisible: true,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  return (
    <section
      className="greenwood-interior__section greenwood-fire-hollow"
      aria-labelledby="gf-hollow"
    >
      <h2
        id="gf-hollow"
        className="greenwood-member__section-title greenwood-member__section-title--hollow"
      >
        THE HOLLOW
      </h2>
      <p>
        Things are sometimes left here for those the Greenwood remembers.
      </p>
      {hasAvailable === true ? (
        <p className="greenwood-fire-hollow__hint">something waits.</p>
      ) : null}
      <p className="greenwood-fire-hollow__action">
        <Link href="/greenwood/hollow" className="btn-text">
          [ CHECK THE HOLLOW ]
        </Link>
      </p>
    </section>
  );
}
