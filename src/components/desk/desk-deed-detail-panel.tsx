"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useDeskGate } from "@/components/desk/desk-gate";
import { buildDefaultDeedWallInscription } from "@/lib/desk/deed-inscription";
import type { DeskDeedDetail } from "@/lib/desk/deeds-types";

export function DeskDeedDetailPanel({ submissionId }: { submissionId: string }) {
  const { getAuthHeaders } = useDeskGate();
  const [detail, setDetail] = useState<DeskDeedDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [rangeAmount, setRangeAmount] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [composeWall, setComposeWall] = useState(false);
  const [wallBody, setWallBody] = useState("");
  const [wallPreview, setWallPreview] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setError("Could not open submission.");
      return;
    }
    const response = await fetch(`/api/desk/deeds/submissions/${submissionId}`, {
      headers,
      cache: "no-store",
    });
    const data = (await response.json()) as {
      submission?: DeskDeedDetail;
      error?: string;
    };
    if (!response.ok || !data.submission) {
      setError(data.error ?? "Submission not found.");
      setDetail(null);
      return;
    }
    setDetail(data.submission);
    if (
      data.submission.status === "approved" &&
      !data.submission.wallShare?.shared
    ) {
      setWallBody(
        buildDefaultDeedWallInscription({
          deedTitle: data.submission.deedTitle,
          displayName: data.submission.displayName,
          leafAwarded: data.submission.leafAwarded,
        }),
      );
    }
  }, [getAuthHeaders, submissionId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function viewImage() {
    const headers = await getAuthHeaders();
    if (!headers) return;
    const response = await fetch(
      `/api/desk/deeds/submissions/${submissionId}/image`,
      { headers, cache: "no-store" },
    );
    const data = (await response.json()) as {
      signedUrl?: string;
      error?: string;
    };
    if (response.ok && data.signedUrl) {
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } else {
      setError(data.error ?? "Image could not be opened.");
    }
  }

  async function approve() {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      let leafAmount: number | null | undefined;
      if (detail.reward.type === "range") {
        const parsed = Number.parseInt(rangeAmount, 10);
        if (!Number.isInteger(parsed)) {
          setError("Enter an integer amount within range.");
          return;
        }
        leafAmount = parsed;
      }
      const response = await fetch(
        `/api/desk/deeds/submissions/${submissionId}/approve`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ leafAmount }),
          cache: "no-store",
        },
      );
      const data = (await response.json()) as {
        error?: string;
        result?: { finalized?: boolean; leafAwarded?: number };
      };
      if (!response.ok) {
        setError(data.error ?? "Approval failed.");
        return;
      }
      setStatus(
        data.result?.finalized === false
          ? "Already approved."
          : `Approved. LEAF awarded: ${data.result?.leafAwarded ?? 0}.`,
      );
      setConfirmApprove(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!rejectNote.trim()) {
      setError("Rejection reason is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch(
        `/api/desk/deeds/submissions/${submissionId}/reject`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ reviewNote: rejectNote.trim() }),
          cache: "no-store",
        },
      );
      const data = (await response.json()) as {
        error?: string;
        result?: { finalized?: boolean };
      };
      if (!response.ok) {
        setError(data.error ?? "Rejection failed.");
        return;
      }
      setStatus(
        data.result?.finalized === false
          ? "Already rejected."
          : "Rejected. No LEAF awarded.",
      );
      setConfirmReject(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function shareToWall() {
    if (!wallBody.trim()) {
      setError("Inscription body is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) {
        setError("Could not open Desk session.");
        return;
      }
      let response: Response;
      try {
        response = await fetch(
          `/api/desk/deeds/submissions/${submissionId}/share-to-wall`,
          {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ body: wallBody }),
            cache: "no-store",
          },
        );
      } catch {
        setError("Network failure while inscribing.");
        return;
      }
      let data: {
        error?: string;
        created?: boolean;
        code?: string;
      } | null = null;
      try {
        data = (await response.json()) as {
          error?: string;
          created?: boolean;
          code?: string;
        };
      } catch {
        data = null;
      }
      if (!response.ok) {
        setError(
          data?.code === "schema_not_ready"
            ? (data.error ??
                "Wall link migration is not applied yet.")
            : (data?.error ??
                (response.status === 401
                  ? "Sign in required."
                  : response.status === 403
                    ? "Desk access denied."
                    : "Could not inscribe on the Wall.")),
        );
        return;
      }
      setStatus(
        data?.created === false
          ? "Already inscribed on the Wall."
          : "INSCRIBED ON THE WALL",
      );
      setComposeWall(false);
      setWallPreview(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!detail && !error) return <p className="muted">…</p>;
  if (error && !detail) {
    return (
      <section>
        <p className="muted">{error}</p>
        <Link href="/desk/deeds?view=submissions" className="btn-text">
          [ back ]
        </Link>
      </section>
    );
  }
  if (!detail) return null;

  const proposed =
    detail.reward.type === "fixed"
      ? detail.reward.amount
      : detail.reward.type === "range"
        ? rangeAmount || `${detail.reward.min}–${detail.reward.max}`
        : 0;

  const canInscribe =
    detail.status === "approved" && !detail.wallShare?.shared;

  return (
    <section className="desk-deed-detail" aria-label={detail.deedTitle}>
      <p>
        <Link href="/desk/deeds?view=submissions" className="btn-text">
          [ back to submissions ]
        </Link>
        <button type="button" className="btn-text" onClick={() => void load()}>
          [ refresh ]
        </button>
      </p>
      <h2 className="desk-section-title">{detail.deedTitle}</h2>
      {status ? <p>{status}</p> : null}
      {error ? <p className="muted">{error}</p> : null}

      <h3 className="desk-overview__group-title">DEED</h3>
      <ul className="desk-member__facts">
        <li>{detail.deedDescription}</li>
        <li>Reward: {detail.rewardLabel}</li>
        <li>
          Scope: {detail.accessScope}
          {detail.greenwoodOnly ? " (Greenwood-only)" : ""}
        </li>
        <li>Repeatable: {detail.isRepeatable ? "yes" : "no"}</li>
        <li>
          Dates: {detail.startsAt ?? "—"} → {detail.endsAt ?? "—"}
        </li>
      </ul>

      <h3 className="desk-overview__group-title">OUTLAW</h3>
      {detail.sigil ? (
        <pre className="ascii desk__sigil" aria-label={detail.sigil.a11yLabel}>
          {detail.sigil.asciiBody}
        </pre>
      ) : null}
      <ul className="desk-member__facts">
        <li>
          {detail.displayName} · {detail.outlawLabel}
        </li>
        <li>
          <Link
            href={`/desk/register/${detail.profileId}`}
            className="btn-text"
          >
            [ register ]
          </Link>
        </li>
      </ul>

      <h3 className="desk-overview__group-title">SUBMISSION</h3>
      <ul className="desk-member__facts">
        <li>Status: {detail.status}</li>
        <li>Submitted: {detail.submittedAt}</li>
        <li>Text: {detail.evidenceText ?? "—"}</li>
        <li>
          URL:{" "}
          {detail.evidenceUrl ? (
            <a
              href={detail.evidenceUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-text"
            >
              [ open ]
            </a>
          ) : (
            "—"
          )}
        </li>
        <li>Other: {detail.evidenceOther ?? "—"}</li>
        <li>
          Image:{" "}
          {detail.hasImageEvidence ? (
            <button
              type="button"
              className="btn-text"
              onClick={() => void viewImage()}
            >
              [ view evidence ]
            </button>
          ) : (
            "—"
          )}
        </li>
        {detail.reviewedAt ? <li>Reviewed: {detail.reviewedAt}</li> : null}
        {detail.reviewNote ? <li>Note: {detail.reviewNote}</li> : null}
        {detail.leafAwarded != null ? (
          <li>LEAF awarded: {detail.leafAwarded}</li>
        ) : null}
      </ul>

      <h3 className="desk-overview__group-title">REWARD PREVIEW</h3>
      <ul className="desk-member__facts">
        <li>Kind: {detail.rewardPreview.kind}</li>
        {detail.rewardPreview.fixedAmount != null ? (
          <li>Fixed: {detail.rewardPreview.fixedAmount}</li>
        ) : null}
        {detail.rewardPreview.min != null ? (
          <li>
            Range: {detail.rewardPreview.min}–{detail.rewardPreview.max}
          </li>
        ) : null}
        <li>Source: {detail.rewardPreview.expectedSource}</li>
      </ul>

      {detail.status === "approved" ? (
        <div className="desk-gatherings__actions">
          <p>
            APPROVED
            {detail.leafAwarded != null
              ? ` · LEAF AWARDED: ${detail.leafAwarded}`
              : ""}
          </p>
          {detail.wallShare?.shared ? (
            <>
              <p>INSCRIBED ON THE WALL</p>
              <Link href="/wall" className="btn-text">
                [ VIEW INSCRIPTION ]
              </Link>
            </>
          ) : null}
          {canInscribe && !composeWall ? (
            <button
              type="button"
              className="btn-text"
              disabled={busy}
              onClick={() => setComposeWall(true)}
            >
              [ INSCRIBE ON THE WALL ]
            </button>
          ) : null}
          {canInscribe && composeWall ? (
            <div className="desk-gatherings__confirm">
              <p>WALL INSCRIPTION</p>
              <label className="desk-register__field">
                Body
                <textarea
                  rows={12}
                  value={wallBody}
                  onChange={(e) => setWallBody(e.target.value)}
                />
              </label>
              {wallPreview ? <pre className="ascii">{wallBody}</pre> : null}
              <button
                type="button"
                className="btn-text"
                onClick={() => setWallPreview((v) => !v)}
              >
                [ PREVIEW ]
              </button>
              <button
                type="button"
                className="btn-text"
                disabled={busy}
                onClick={() => void shareToWall()}
              >
                [ INSCRIBE ]
              </button>
              <button
                type="button"
                className="btn-text"
                onClick={() => {
                  setComposeWall(false);
                  setWallPreview(false);
                }}
              >
                [ CANCEL ]
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {detail.status === "pending" ? (
        <div className="desk-gatherings__actions">
          {!confirmApprove ? (
            <button
              type="button"
              className="btn-text"
              disabled={busy}
              onClick={() => setConfirmApprove(true)}
            >
              [ prepare approve ]
            </button>
          ) : (
            <div className="desk-gatherings__confirm">
              <p>APPROVE THIS DEED</p>
              <p className="muted">
                {detail.deedTitle} · {detail.displayName} · proposed LEAF{" "}
                {proposed}. Source: deed_approval.
              </p>
              {detail.reward.type === "range" ? (
                <label className="desk-register__field">
                  Amount ({detail.reward.min}–{detail.reward.max})
                  <input
                    value={rangeAmount}
                    onChange={(e) => setRangeAmount(e.target.value)}
                    inputMode="numeric"
                  />
                </label>
              ) : null}
              <button
                type="button"
                className="btn-text"
                disabled={busy}
                onClick={() => void approve()}
              >
                [ confirm approve ]
              </button>
              <button
                type="button"
                className="btn-text"
                onClick={() => setConfirmApprove(false)}
              >
                [ cancel ]
              </button>
            </div>
          )}

          {!confirmReject ? (
            <button
              type="button"
              className="btn-text"
              disabled={busy}
              onClick={() => setConfirmReject(true)}
            >
              [ prepare reject ]
            </button>
          ) : (
            <div className="desk-gatherings__confirm">
              <p>REJECT THIS DEED</p>
              <p className="muted">
                {detail.deedTitle} · {detail.displayName}. No LEAF will be
                awarded.
              </p>
              <label className="desk-register__field">
                Reason
                <input
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  required
                />
              </label>
              <button
                type="button"
                className="btn-text"
                disabled={busy}
                onClick={() => void reject()}
              >
                [ confirm reject ]
              </button>
              <button
                type="button"
                className="btn-text"
                onClick={() => setConfirmReject(false)}
              >
                [ cancel ]
              </button>
            </div>
          )}
        </div>
      ) : detail.status === "rejected" ? (
        <p className="muted">This submission is already rejected.</p>
      ) : null}
    </section>
  );
}
