"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { useDeskGate } from "@/components/desk/desk-gate";
import type {
  DeskCampaignDetail,
  DeskCampaignPreview,
} from "@/lib/desk/hollow-types";
import { isOnChainRewardType } from "@/lib/desk/hollow-types";

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function DeskHollowDetailPanel({ campaignId }: { campaignId: string }) {
  const { getAuthHeaders } = useDeskGate();
  const [detail, setDetail] = useState<DeskCampaignDetail | null>(null);
  const [preview, setPreview] = useState<DeskCampaignPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [confirmResolve, setConfirmResolve] = useState(false);
  const [confirmAvailable, setConfirmAvailable] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const [txRewardId, setTxRewardId] = useState<string | null>(null);
  const [txHash, setTxHash] = useState("");
  const [confirmTx, setConfirmTx] = useState(false);

  const [correctRewardId, setCorrectRewardId] = useState<string | null>(null);
  const [correctHash, setCorrectHash] = useState("");
  const [correctReason, setCorrectReason] = useState("");
  const [confirmCorrect, setConfirmCorrect] = useState(false);

  const [confirmMarkId, setConfirmMarkId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setError("Could not open campaign.");
      setDetail(null);
      return;
    }
    const response = await fetch(`/api/desk/hollow/campaigns/${campaignId}`, {
      headers,
      cache: "no-store",
    });
    const data = (await response.json()) as {
      ok?: boolean;
      campaign?: DeskCampaignDetail;
      error?: string;
    };
    if (!response.ok || !data.campaign) {
      setError(data.error ?? "Campaign not found.");
      setDetail(null);
      return;
    }
    setDetail(data.campaign);
  }, [campaignId, getAuthHeaders]);

  const loadPreview = useCallback(async () => {
    const headers = await getAuthHeaders();
    if (!headers) return;
    const response = await fetch(
      `/api/desk/hollow/campaigns/${campaignId}/preview`,
      { headers, cache: "no-store", method: "POST" },
    );
    const data = (await response.json()) as {
      preview?: DeskCampaignPreview;
      error?: string;
    };
    if (!response.ok) {
      setError(data.error ?? "Preview failed.");
      setPreview(null);
      return;
    }
    setPreview(data.preview ?? null);
  }, [campaignId, getAuthHeaders]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!detail) return;
    if (
      detail.status !== "available" &&
      detail.status !== "executing" &&
      detail.status !== "resolved"
    ) {
      return;
    }
    const interval = window.setInterval(() => {
      void load();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [detail, load]);

  async function act(
    path: string,
    okMessage: string,
    body?: Record<string, unknown>,
  ) {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch(path, {
        method: "POST",
        headers: body
          ? { ...headers, "Content-Type": "application/json" }
          : headers,
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      const data = (await response.json()) as {
        error?: string;
        campaign?: DeskCampaignDetail;
      };
      if (!response.ok) {
        setError(data.error ?? "Action failed.");
        return;
      }
      setStatus(okMessage);
      if (data.campaign) setDetail(data.campaign);
      else await load();
      setConfirmResolve(false);
      setConfirmAvailable(false);
      setConfirmCancel(false);
      setConfirmTx(false);
      setConfirmCorrect(false);
      setConfirmMarkId(null);
      setTxRewardId(null);
      setCorrectRewardId(null);
      setTxHash("");
      setCorrectHash("");
      setCorrectReason("");
    } finally {
      setBusy(false);
    }
  }

  async function recordTx(event: FormEvent) {
    event.preventDefault();
    if (!txRewardId || !txHash.trim() || !confirmTx) return;
    await act(
      `/api/desk/hollow/rewards/${txRewardId}/record-transaction`,
      "Transaction recorded.",
      { transactionHash: txHash.trim() },
    );
  }

  async function correctTx(event: FormEvent) {
    event.preventDefault();
    if (
      !correctRewardId ||
      !correctHash.trim() ||
      !correctReason.trim() ||
      !confirmCorrect
    ) {
      return;
    }
    await act(
      `/api/desk/hollow/rewards/${correctRewardId}/correct-transaction`,
      "Transaction corrected.",
      {
        transactionHash: correctHash.trim(),
        reason: correctReason.trim(),
      },
    );
  }

  if (!detail && !error) return <p className="muted">…</p>;
  if (error && !detail) {
    return (
      <section>
        <p className="muted">{error}</p>
        <Link href="/desk/hollow" className="btn-text">
          [ back ]
        </Link>
      </section>
    );
  }
  if (!detail) return null;

  const onChain = isOnChainRewardType(detail.rewardType);
  const canEditDraft = detail.status === "draft";
  const canResolve = detail.status === "draft";
  const canCancel =
    detail.status !== "cancelled" &&
    detail.status !== "completed" &&
    detail.statusCounts.claimed === 0 &&
    detail.statusCounts.sent === 0 &&
    detail.statusCounts.confirmed === 0;

  return (
    <section className="desk-hollow-detail" aria-label={detail.title}>
      <p>
        <Link href="/desk/hollow" className="btn-text">
          [ back to The Hollow ]
        </Link>
        <button type="button" className="btn-text" onClick={() => void load()}>
          [ refresh ]
        </button>
      </p>
      <h2 className="desk-section-title">{detail.title}</h2>
      <p className="muted">{detail.reason}</p>
      {status ? <p>{status}</p> : null}
      {error ? <p className="muted">{error}</p> : null}

      <p className="desk-divider" aria-hidden>
        ────────────────────
      </p>

      <h3 className="desk-overview__group-title">SUMMARY</h3>
      <ul className="desk-member__facts">
        <li>
          Type: {detail.rewardType}
          {detail.amountPerRecipient != null
            ? ` · ${detail.amountPerRecipient}${detail.assetSymbol ? ` ${detail.assetSymbol}` : ""} each`
            : ""}
        </li>
        <li>
          Total:{" "}
          {detail.totalAmount != null
            ? `${detail.totalAmount}${detail.assetSymbol ? ` ${detail.assetSymbol}` : ""}`
            : "—"}
        </li>
        <li>
          Rule: {detail.recipientRule}
          {detail.gatheringTitle
            ? ` · Gathering: ${detail.gatheringTitle}`
            : ""}
          {detail.gatheringId ? (
            <>
              {" · "}
              <Link
                href={`/desk/gatherings/${detail.gatheringId}`}
                className="btn-text"
              >
                [ gathering ]
              </Link>
            </>
          ) : null}
        </li>
        <li>Status: {detail.status}</li>
        <li>Recipients: {detail.recipientCount}</li>
        <li>
          Counts — claimed {detail.statusCounts.claimed} · available{" "}
          {detail.statusCounts.available} · awaiting send{" "}
          {detail.statusCounts.awaitingSend} · sent {detail.statusCounts.sent} ·
          confirmed {detail.statusCounts.confirmed} · failed{" "}
          {detail.statusCounts.failed}
        </li>
        <li>Created: {detail.createdAt}</li>
        <li>Resolved: {detail.resolvedAt ?? "—"}</li>
        <li>Available: {detail.availableAt ?? "—"}</li>
        {detail.assetChainId != null ? (
          <li>Chain ID: {detail.assetChainId}</li>
        ) : null}
        {detail.assetContractAddress ? (
          <li>Token: {detail.assetContractAddress}</li>
        ) : null}
        {detail.requiresAttention ? (
          <li className="muted">This campaign needs attention.</li>
        ) : null}
      </ul>

      <h3 className="desk-overview__group-title">ACTIONS</h3>
      <div className="desk-gatherings__actions">
        {canEditDraft ? (
          <button
            type="button"
            className="btn-text"
            disabled={busy}
            onClick={() => void loadPreview()}
          >
            [ preview recipients ]
          </button>
        ) : null}

        {canResolve ? (
          !confirmResolve ? (
            <button
              type="button"
              className="btn-text"
              disabled={busy}
              onClick={() => {
                void loadPreview();
                setConfirmResolve(true);
              }}
            >
              [ prepare resolve ]
            </button>
          ) : (
            <div className="desk-gatherings__confirm">
              <p>RESOLVE THIS CAMPAIGN</p>
              <p className="muted">
                The recipient list cannot be changed after it is resolved.
              </p>
              <button
                type="button"
                className="btn-text"
                disabled={busy}
                onClick={() =>
                  void act(
                    `/api/desk/hollow/campaigns/${detail.id}/resolve`,
                    "Resolved. Recipients are frozen.",
                  )
                }
              >
                [ confirm resolve ]
              </button>
              <button
                type="button"
                className="btn-text"
                onClick={() => setConfirmResolve(false)}
              >
                [ cancel ]
              </button>
            </div>
          )
        ) : null}

        {detail.rewardType === "leaf" && detail.status === "resolved" ? (
          !confirmAvailable ? (
            <button
              type="button"
              className="btn-text"
              disabled={busy}
              onClick={() => setConfirmAvailable(true)}
            >
              [ prepare place in Hollow ]
            </button>
          ) : (
            <div className="desk-gatherings__confirm">
              <p>PLACE THESE REWARDS IN THE HOLLOW</p>
              <p className="muted">
                {detail.recipientCount} recipients ·{" "}
                {detail.amountPerRecipient ?? "—"} LEAF each · total{" "}
                {detail.totalAmount ?? "—"}. Members must claim through their own Hollow. This does not award LEAF directly.
              </p>
              <button
                type="button"
                className="btn-text"
                disabled={busy}
                onClick={() =>
                  void act(
                    `/api/desk/hollow/campaigns/${detail.id}/make-available`,
                    "Rewards placed in The Hollow.",
                  )
                }
              >
                [ confirm place ]
              </button>
              <button
                type="button"
                className="btn-text"
                onClick={() => setConfirmAvailable(false)}
              >
                [ cancel ]
              </button>
            </div>
          )
        ) : null}

        {detail.rewardType === "leaf" && detail.status === "available" ? (
          <p className="muted">Already available in The Hollow.</p>
        ) : null}

        {canCancel ? (
          !confirmCancel ? (
            <button
              type="button"
              className="btn-text"
              disabled={busy}
              onClick={() => setConfirmCancel(true)}
            >
              [ prepare cancel ]
            </button>
          ) : (
            <div className="desk-gatherings__confirm">
              <p>CANCEL THIS CAMPAIGN</p>
              <p className="muted">
                Status {detail.status} · {detail.recipientCount} recipients ·{" "}
                {detail.rewardType}. History is kept.
              </p>
              <label className="desk-register__field">
                Reason
                <input
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn-text"
                disabled={busy}
                onClick={() =>
                  void act(
                    `/api/desk/hollow/campaigns/${detail.id}/cancel`,
                    "Campaign cancelled.",
                    { reason: cancelReason || null },
                  )
                }
              >
                [ confirm cancel ]
              </button>
              <button
                type="button"
                className="btn-text"
                onClick={() => setConfirmCancel(false)}
              >
                [ back ]
              </button>
            </div>
          )
        ) : detail.status !== "cancelled" &&
          detail.status !== "completed" &&
          (detail.statusCounts.claimed > 0 ||
            detail.statusCounts.sent > 0 ||
            detail.statusCounts.confirmed > 0) ? (
          <p className="muted">
            Cancellation is blocked while claimed or sent rewards exist.
          </p>
        ) : null}
      </div>

      {preview ? (
        <>
          <h3 className="desk-overview__group-title">PREVIEW</h3>
          <p className="muted">
            Preview does not freeze recipients. Resolution recalculates on the
            server.
          </p>
          <ul className="desk-member__facts">
            <li>
              Valid {preview.validRecipientCount} · invalid{" "}
              {preview.invalidRecipientCount} · excluded {preview.excludedCount}{" "}
              · missing wallet {preview.missingWalletCount} · duplicates{" "}
              {preview.duplicateCount}
            </li>
            <li>
              Total:{" "}
              {preview.totalAmount != null
                ? String(preview.totalAmount)
                : "—"}
            </li>
            {preview.gatheringTitle ? (
              <li>Gathering: {preview.gatheringTitle}</li>
            ) : null}
          </ul>
          <ul className="desk-member__list">
            {preview.recipients.map((r) => (
              <li key={r.profileId}>
                {r.displayName} · {r.outlawLabel}
                {r.walletShort ? ` · ${r.walletShort}` : ""}
                {r.valid ? "" : ` · excluded: ${r.exclusionReason ?? "invalid"}`}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3 className="desk-overview__group-title">RECIPIENTS</h3>
      {detail.recipients.length === 0 ? (
        <p className="muted">
          {detail.status === "draft"
            ? "No frozen recipients yet. Preview, then resolve."
            : "No recipients."}
        </p>
      ) : (
        <ul className="desk-member__list">
          {detail.recipients.map((r) => (
            <li key={r.id}>
              <div>
                {r.displayName} · {r.outlawLabel} ·{" "}
                <Link
                  href={`/desk/register/${r.profileId}`}
                  className="btn-text"
                >
                  [ register ]
                </Link>
              </div>
              <div className="muted">
                Hollow: {r.hollowStatus ?? "—"}
                {r.claimedAt ? ` · claimed ${r.claimedAt}` : ""}
                {r.failureReason ? ` · ${r.failureReason}` : ""}
              </div>
              {onChain ? (
                <div className="desk-register__wallet-actions">
                  <span>{r.walletShort ?? "no wallet snapshot"}</span>
                  {r.walletAddressSnapshot ? (
                    <button
                      type="button"
                      className="btn-text"
                      onClick={() =>
                        void copyText(r.walletAddressSnapshot!).then((ok) => {
                          if (ok) setStatus("Wallet copied.");
                        })
                      }
                    >
                      [ copy wallet ]
                    </button>
                  ) : null}
                  {r.transactionHash ? (
                    <>
                      <span>
                        {r.explorerUrl ? (
                          <a
                            href={r.explorerUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="btn-text"
                          >
                            [ tx ]
                          </a>
                        ) : (
                          r.transactionHash.slice(0, 10) + "…"
                        )}
                      </span>
                      {r.hollowStatus === "sent" ||
                      r.hollowStatus === "confirmed" ? (
                        <button
                          type="button"
                          className="btn-text"
                          onClick={() => {
                            setCorrectRewardId(r.hollowRewardId);
                            setCorrectHash("");
                            setCorrectReason("");
                            setConfirmCorrect(false);
                          }}
                        >
                          [ correct tx ]
                        </button>
                      ) : null}
                      {r.hollowStatus === "sent" && r.hollowRewardId ? (
                        <button
                          type="button"
                          className="btn-text"
                          onClick={() => setConfirmMarkId(r.hollowRewardId)}
                        >
                          [ mark confirmed ]
                        </button>
                      ) : null}
                    </>
                  ) : r.hollowStatus === "awaiting_send" && r.hollowRewardId ? (
                    <button
                      type="button"
                      className="btn-text"
                      onClick={() => {
                        setTxRewardId(r.hollowRewardId);
                        setTxHash("");
                        setConfirmTx(false);
                      }}
                    >
                      [ record tx ]
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {txRewardId ? (
        <form
          className="desk-gatherings__confirm"
          onSubmit={(e) => void recordTx(e)}
        >
          <p>RECORD TRANSACTION</p>
          <p className="muted">
            Requires a valid transaction hash. Nothing is sent from The Desk.
          </p>
          <label className="desk-register__field">
            Transaction hash
            <input
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
              required
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={confirmTx}
              onChange={(e) => setConfirmTx(e.target.checked)}
            />{" "}
            I confirm this hash was sent to the frozen wallet.
          </label>
          <button
            type="submit"
            className="btn-text"
            disabled={busy || !confirmTx}
          >
            [ confirm record ]
          </button>
          <button
            type="button"
            className="btn-text"
            onClick={() => setTxRewardId(null)}
          >
            [ cancel ]
          </button>
        </form>
      ) : null}

      {correctRewardId ? (
        <form
          className="desk-gatherings__confirm"
          onSubmit={(e) => void correctTx(e)}
        >
          <p>CORRECT TRANSACTION</p>
          <p className="muted">
            Previous evidence is preserved in audit. Recipient, wallet, amount
            and asset cannot change.
          </p>
          <label className="desk-register__field">
            New transaction hash
            <input
              value={correctHash}
              onChange={(e) => setCorrectHash(e.target.value)}
              required
            />
          </label>
          <label className="desk-register__field">
            Reason
            <input
              value={correctReason}
              onChange={(e) => setCorrectReason(e.target.value)}
              required
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={confirmCorrect}
              onChange={(e) => setConfirmCorrect(e.target.checked)}
            />{" "}
            I confirm this correction.
          </label>
          <button
            type="submit"
            className="btn-text"
            disabled={busy || !confirmCorrect}
          >
            [ confirm correction ]
          </button>
          <button
            type="button"
            className="btn-text"
            onClick={() => setCorrectRewardId(null)}
          >
            [ cancel ]
          </button>
        </form>
      ) : null}

      {confirmMarkId ? (
        <div className="desk-gatherings__confirm">
          <p>MARK AS CONFIRMED</p>
          <p className="muted">
            This records an operational confirmation. It does not independently verify the chain unless a verifier is present.
          </p>
          <button
            type="button"
            className="btn-text"
            disabled={busy}
            onClick={() =>
              void act(
                `/api/desk/hollow/rewards/${confirmMarkId}/mark-confirmed`,
                "Marked confirmed.",
              )
            }
          >
            [ confirm mark confirmed ]
          </button>
          <button
            type="button"
            className="btn-text"
            onClick={() => setConfirmMarkId(null)}
          >
            [ cancel ]
          </button>
        </div>
      ) : null}
    </section>
  );
}
