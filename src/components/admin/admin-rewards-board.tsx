"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import type {
  AdminCampaignDetail,
  AdminCampaignListItem,
  AdminCampaignPreview,
  HollowRewardType,
} from "@/lib/greenwood/hollow/types";

function gatheringIdFromSearch(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("gathering") ?? "";
}

export function AdminRewardsBoard() {
  const { privyReady, loading, authenticated, getAuthHeaders, login } =
    useFennAuth();
  const [items, setItems] = useState<AdminCampaignListItem[] | null>(null);
  const [detail, setDetail] = useState<AdminCampaignDetail | null>(null);
  const [preview, setPreview] = useState<AdminCampaignPreview | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("Hollow remembrance");
  const [reason, setReason] = useState("left for those who raised a hand");
  const [rewardType, setRewardType] = useState<HollowRewardType>("leaf");
  const [amount, setAmount] = useState("25");
  const [profileIds, setProfileIds] = useState("");
  const [gatheringId, setGatheringId] = useState(gatheringIdFromSearch);
  const [txHash, setTxHash] = useState("");
  const [txRewardId, setTxRewardId] = useState("");

  const loadList = useCallback(async () => {
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setDenied(true);
      setItems([]);
      return;
    }
    const response = await fetch("/api/admin/greenwood/rewards", {
      headers,
      cache: "no-store",
    });
    if (response.status === 401 || response.status === 403) {
      setDenied(true);
      setItems([]);
      return;
    }
    const data = (await response.json()) as {
      ok?: boolean;
      campaigns?: AdminCampaignListItem[];
      error?: string;
    };
    if (!response.ok || !data.ok) {
      setError(data.error ?? "desk failed");
      setItems([]);
      return;
    }
    setDenied(false);
    setItems(data.campaigns ?? []);
  }, [getAuthHeaders]);

  useEffect(() => {
    if (!privyReady || loading || !authenticated) return;
    const timer = window.setTimeout(() => {
      void loadList();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [privyReady, loading, authenticated, loadList]);

  async function createDraft(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const fromGathering = gatheringId.trim().length > 0;
      const path = fromGathering
        ? `/api/admin/greenwood/rewards/from-gathering/${gatheringId.trim()}`
        : "/api/admin/greenwood/rewards";
      const body = fromGathering
        ? {
            title,
            reason,
            rewardType,
            amountPerRecipient:
              rewardType === "informational" ? null : Number(amount),
            assetSymbol: rewardType === "eth" ? "ETH" : null,
            assetChainId: rewardType === "eth" || rewardType === "erc20" ? 1 : null,
          }
        : {
            title,
            reason,
            rewardType,
            amountPerRecipient:
              rewardType === "informational" ? null : Number(amount),
            recipientRule: "manual_profiles",
            profileIds: profileIds
              .split(/[\s,]+/)
              .map((s) => s.trim())
              .filter(Boolean),
            assetSymbol: rewardType === "eth" ? "ETH" : null,
            assetChainId: rewardType === "eth" || rewardType === "erc20" ? 1 : null,
          };
      const response = await fetch(path, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "create failed");
        return;
      }
      setStatus("draft created.");
      await loadList();
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(id: string) {
    const headers = await getAuthHeaders();
    if (!headers) return;
    const [detailRes, previewRes] = await Promise.all([
      fetch(`/api/admin/greenwood/rewards/${id}`, {
        headers,
        cache: "no-store",
      }),
      fetch(`/api/admin/greenwood/rewards/${id}/preview`, {
        headers,
        cache: "no-store",
      }),
    ]);
    const detailData = (await detailRes.json()) as {
      campaign?: AdminCampaignDetail;
      error?: string;
    };
    const previewData = (await previewRes.json()) as {
      preview?: AdminCampaignPreview;
    };
    if (!detailRes.ok || !detailData.campaign) {
      setError(detailData.error ?? "detail failed");
      return;
    }
    setDetail(detailData.campaign);
    setPreview(previewData.preview ?? null);
  }

  async function act(path: string, okMessage: string) {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch(path, {
        method: "POST",
        headers,
        cache: "no-store",
      });
      const data = (await response.json()) as {
        error?: string;
        campaign?: AdminCampaignDetail;
      };
      if (!response.ok) {
        setError(data.error ?? "action failed");
        return;
      }
      setStatus(okMessage);
      if (data.campaign) setDetail(data.campaign);
      await loadList();
    } finally {
      setBusy(false);
    }
  }

  async function recordTx(event: FormEvent) {
    event.preventDefault();
    if (!txRewardId.trim() || !txHash.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch(
        `/api/admin/greenwood/hollow/${txRewardId.trim()}/record-transaction`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ transactionHash: txHash.trim() }),
        },
      );
      const data = (await response.json()) as {
        error?: string;
        campaign?: AdminCampaignDetail;
      };
      if (!response.ok) {
        setError(data.error ?? "record failed");
        return;
      }
      setStatus("transaction recorded.");
      if (data.campaign) setDetail(data.campaign);
      setTxHash("");
    } finally {
      setBusy(false);
    }
  }

  if (!privyReady || loading) {
    return <p className="muted">the desk is waking...</p>;
  }
  if (!authenticated) {
    return (
      <div className="admin-deeds">
        <p>admin sign-in required.</p>
        <button type="button" className="btn-text" onClick={() => login()}>
          [ enter ]
        </button>
      </div>
    );
  }
  if (denied) {
    return (
      <div className="admin-deeds">
        <p>this desk is not for your hand.</p>
      </div>
    );
  }

  return (
    <div className="admin-deeds admin-rewards">
      <header className="admin-deeds__header">
        <p className="admin-deeds__eyebrow">GREENWOOD · THE HOLLOW</p>
        <h1 className="place__title">REWARD CAMPAIGNS</h1>
        <p className="muted">
          freeze recipients, make LEAF available, record on-chain sends. no
          automatic treasury signing.
        </p>
        <p>
          <Link href="/admin/greenwood/gatherings" className="btn-text">
            [ gatherings desk ]
          </Link>
        </p>
      </header>

      {status ? <p className="admin-deeds__status">{status}</p> : null}
      {error ? <p className="deed-proof__error">{error}</p> : null}

      <form className="admin-gatherings__form" onSubmit={createDraft}>
        <h2 className="deed-detail__label">CREATE DRAFT</h2>
        <label className="deed-proof-field">
          <span className="deed-proof-field__label">title</span>
          <input
            className="deed-proof-field__control"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>
        <label className="deed-proof-field">
          <span className="deed-proof-field__label">reason</span>
          <textarea
            className="deed-proof-field__control"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
          />
        </label>
        <label className="deed-proof-field">
          <span className="deed-proof-field__label">reward type</span>
          <select
            className="deed-proof-field__control"
            value={rewardType}
            onChange={(e) =>
              setRewardType(e.target.value as HollowRewardType)
            }
          >
            <option value="leaf">leaf</option>
            <option value="eth">eth</option>
            <option value="erc20">erc20</option>
            <option value="informational">informational</option>
          </select>
        </label>
        {rewardType !== "informational" ? (
          <label className="deed-proof-field">
            <span className="deed-proof-field__label">amount per recipient</span>
            <input
              className="deed-proof-field__control"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="numeric"
              required
            />
          </label>
        ) : null}
        <label className="deed-proof-field">
          <span className="deed-proof-field__label">
            closed gathering id (open hands) — optional
          </span>
          <input
            className="deed-proof-field__control"
            value={gatheringId}
            onChange={(e) => setGatheringId(e.target.value)}
            placeholder="uuid"
          />
        </label>
        {!gatheringId.trim() ? (
          <label className="deed-proof-field">
            <span className="deed-proof-field__label">
              manual profile ids (comma/space separated)
            </span>
            <textarea
              className="deed-proof-field__control"
              value={profileIds}
              onChange={(e) => setProfileIds(e.target.value)}
              rows={2}
            />
          </label>
        ) : null}
        <button type="submit" className="btn-text" disabled={busy}>
          [ create draft ]
        </button>
      </form>

      <hr className="greenwood-member__rule" />
      <h2 className="deed-detail__label">CAMPAIGNS</h2>
      {items == null ? (
        <p className="muted">loading...</p>
      ) : items.length === 0 ? (
        <p className="muted">none yet.</p>
      ) : (
        <ul className="admin-deeds__list">
          {items.map((item) => (
            <li key={item.id} className="admin-deed-ticket">
              <p>
                <strong>{item.title}</strong>
              </p>
              <p className="muted admin-deed-ticket__meta">
                {item.rewardType} · {item.status} · {item.recipientCount}{" "}
                recipients
                {item.totalAmount != null ? ` · total ${item.totalAmount}` : ""}
              </p>
              {item.gatheringTitle ? (
                <p className="muted">from {item.gatheringTitle}</p>
              ) : null}
              <div className="admin-deed-ticket__actions">
                <button
                  type="button"
                  className="btn-text"
                  disabled={busy}
                  onClick={() => {
                    void openDetail(item.id);
                  }}
                >
                  [ inspect ]
                </button>
                {item.status === "draft" ? (
                  <button
                    type="button"
                    className="btn-text"
                    disabled={busy}
                    onClick={() => {
                      void act(
                        `/api/admin/greenwood/rewards/${item.id}/resolve`,
                        "resolved / frozen.",
                      );
                    }}
                  >
                    [ resolve ]
                  </button>
                ) : null}
                {item.status === "resolved" ? (
                  <button
                    type="button"
                    className="btn-text"
                    disabled={busy}
                    onClick={() => {
                      void act(
                        `/api/admin/greenwood/rewards/${item.id}/make-available`,
                        "made available.",
                      );
                    }}
                  >
                    [ make available ]
                  </button>
                ) : null}
                {item.status !== "cancelled" &&
                item.status !== "completed" &&
                item.status !== "completed_partial" ? (
                  <button
                    type="button"
                    className="btn-text"
                    disabled={busy}
                    onClick={() => {
                      void act(
                        `/api/admin/greenwood/rewards/${item.id}/cancel`,
                        "cancelled.",
                      );
                    }}
                  >
                    [ cancel ]
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {preview ? (
        <>
          <hr className="greenwood-member__rule" />
          <h2 className="deed-detail__label">PREVIEW</h2>
          <p className="muted">
            {preview.recipientCount} valid · excluded {preview.excludedCount} ·
            missing wallets {preview.missingWalletCount}
            {preview.totalAmount != null
              ? ` · total ${preview.totalAmount}`
              : ""}
          </p>
          <ul className="admin-deeds__list">
            {preview.recipients.slice(0, 40).map((r) => (
              <li key={`${r.profileId}-${r.eligibilitySourceId}`} className="admin-deed-ticket">
                <p>
                  {r.displayName}{" "}
                  <span className="muted">
                    {r.valid ? "ok" : r.exclusionReason}
                  </span>
                </p>
                <p className="muted ascii">{r.walletAddress ?? "—"}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {detail ? (
        <>
          <hr className="greenwood-member__rule" />
          <h2 className="deed-detail__label">RECIPIENTS · {detail.title}</h2>
          <ul className="admin-deeds__list">
            {detail.recipients.map((r) => (
              <li key={r.id} className="admin-deed-ticket">
                <p>
                  {r.displayName} · hollow {r.hollowStatus ?? "—"}
                </p>
                <p className="muted">
                  {r.outlawLabel}
                  {r.hollowRewardId ? ` · reward ${r.hollowRewardId}` : ""}
                </p>
                {r.walletAddressSnapshot ? (
                  <p className="muted ascii">{r.walletAddressSnapshot}</p>
                ) : null}
                {r.transactionHash ? (
                  <p className="muted ascii">{r.transactionHash}</p>
                ) : null}
              </li>
            ))}
          </ul>

          <form className="admin-gatherings__form" onSubmit={recordTx}>
            <h2 className="deed-detail__label">RECORD ETH/TOKEN TX</h2>
            <label className="deed-proof-field">
              <span className="deed-proof-field__label">hollow reward id</span>
              <input
                className="deed-proof-field__control"
                value={txRewardId}
                onChange={(e) => setTxRewardId(e.target.value)}
              />
            </label>
            <label className="deed-proof-field">
              <span className="deed-proof-field__label">transaction hash</span>
              <input
                className="deed-proof-field__control"
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
              />
            </label>
            <button type="submit" className="btn-text" disabled={busy}>
              [ record sent ]
            </button>
          </form>
        </>
      ) : null}
    </div>
  );
}
