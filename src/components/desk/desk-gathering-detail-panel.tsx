"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { DeskGatheringCallForm } from "@/components/desk/desk-gathering-call-form";
import { DeskGatheringOperate } from "@/components/desk/desk-gathering-operate";
import { useDeskGate } from "@/components/desk/desk-gate";
import type { DeskGatheringDetail } from "@/lib/desk/gatherings-types";

/**
 * Detail route — feature parity with board operate/call flows.
 */
export function DeskGatheringDetailPanel({
  gatheringId,
}: {
  gatheringId: string;
}) {
  const { getAuthHeaders } = useDeskGate();
  const [detail, setDetail] = useState<DeskGatheringDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resumeDraft, setResumeDraft] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setError("Keeper access is required.");
      return;
    }
    const response = await fetch(`/api/desk/gatherings/${gatheringId}`, {
      headers,
      cache: "no-store",
    });
    const data = (await response.json()) as {
      ok?: boolean;
      gathering?: DeskGatheringDetail;
      error?: string;
    };
    if (!response.ok || !data.gathering) {
      setError(data.error ?? "That Gathering could not be found.");
      setDetail(null);
      return;
    }
    setDetail(data.gathering);
  }, [getAuthHeaders, gatheringId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (!detail && !error) return <p className="muted">…</p>;
  if (error && !detail) {
    return (
      <section>
        <p className="desk-gathering-call__error" role="alert">
          {error}
        </p>
        <Link href="/desk/gatherings" className="btn-text">
          [ back ]
        </Link>
      </section>
    );
  }
  if (!detail) return null;

  if (detail.status === "draft" && resumeDraft) {
    return (
      <DeskGatheringCallForm
        getAuthHeaders={getAuthHeaders}
        draftSeed={detail}
        onCancel={() => setResumeDraft(false)}
        onBegun={async () => {
          setResumeDraft(false);
          await load();
        }}
      />
    );
  }

  if (detail.status === "draft") {
    return (
      <section className="desk-gathering-detail" aria-label={detail.title}>
        <p>
          <Link href="/desk/gatherings" className="btn-text">
            [ back to Gatherings ]
          </Link>
          <button type="button" className="btn-text" onClick={() => void load()}>
            [ refresh ]
          </button>
        </p>
        <h2 className="desk-section-title">UNFINISHED CALL</h2>
        <p className="desk-gathering-operate__title">{detail.title}</p>
        <p className="muted">{detail.summary}</p>
        <p className="muted">
          Resume to begin immediately with a new duration. Server time is set when
          you press Begin Gathering.
        </p>
        <div className="desk-gatherings__actions">
          <button
            type="button"
            className="btn-text desk-gathering-call__begin"
            onClick={() => setResumeDraft(true)}
          >
            [ resume call ]
          </button>
        </div>
      </section>
    );
  }

  return (
    <DeskGatheringOperate
      gathering={detail}
      getAuthHeaders={getAuthHeaders}
      showBackLink
      onChanged={() => load()}
    />
  );
}
