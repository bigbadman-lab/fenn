"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { AsciiPageTitle } from "@/components/ui/ascii-page-title";
import {
  fetchGreenwoodHollow,
  postClaimHollowReward,
} from "@/lib/greenwood/client";
import type { SafeHollowReward } from "@/lib/greenwood/hollow/types";
import { formatDeedBoardDate } from "@/lib/deeds/format";

function RewardCard({
  reward,
  pending,
  onClaim,
}: {
  reward: SafeHollowReward;
  pending: boolean;
  onClaim: () => void;
}) {
  if (reward.rewardType === "leaf") {
    if (reward.status === "available" || reward.canClaim) {
      return (
        <li className="greenwood-hollow__item">
          <p className="greenwood-hollow__eyebrow">SOMETHING WAITS</p>
          <p className="greenwood-hollow__title">{reward.title}</p>
          {reward.reason ? <p>{reward.reason}</p> : null}
          {reward.amount != null ? (
            <p className="greenwood-hollow__amount">{reward.amount} LEAF</p>
          ) : null}
          <button
            type="button"
            className="greenwood-fire-gathering__btn"
            disabled={pending || !reward.canClaim}
            onClick={onClaim}
          >
            {pending ? "[ RECEIVING… ]" : "[ RECEIVE LEAF ]"}
          </button>
        </li>
      );
    }
    if (reward.status === "claimed") {
      return (
        <li className="greenwood-hollow__item">
          <p className="greenwood-hollow__title">{reward.title}</p>
          <p className="muted">
            received
            {reward.claimedAt
              ? ` · ${formatDeedBoardDate(reward.claimedAt)}`
              : ""}
          </p>
          {reward.amount != null ? (
            <p className="muted">{reward.amount} LEAF</p>
          ) : null}
        </li>
      );
    }
  }

  if (reward.rewardType === "eth" || reward.rewardType === "erc20") {
    if (reward.status === "awaiting_send") {
      return (
        <li className="greenwood-hollow__item">
          <p className="greenwood-hollow__title">{reward.title}</p>
          <p>
            Something has been marked for you, but it has not yet crossed the
            chain.
          </p>
          {reward.amount != null ? (
            <p className="muted">
              {reward.amount} {reward.assetSymbol ?? "asset"}
            </p>
          ) : null}
        </li>
      );
    }
    if (reward.status === "sent" || reward.status === "confirmed") {
      return (
        <li className="greenwood-hollow__item">
          <p className="greenwood-hollow__title">{reward.title}</p>
          <p className="muted">
            {reward.status === "confirmed"
              ? "confirmed on-chain (manual)"
              : "sent on-chain"}
            {reward.sentAt ? ` · ${formatDeedBoardDate(reward.sentAt)}` : ""}
          </p>
          {reward.amount != null ? (
            <p>
              {reward.amount} {reward.assetSymbol ?? "asset"}
            </p>
          ) : null}
          {reward.walletShort ? (
            <p className="muted">to {reward.walletShort}</p>
          ) : null}
          {reward.explorerUrl && reward.transactionHash ? (
            <p>
              <a
                href={reward.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                [ view transaction ]
              </a>
            </p>
          ) : reward.transactionHash ? (
            <p className="muted ascii">{reward.transactionHash}</p>
          ) : null}
        </li>
      );
    }
  }

  if (reward.rewardType === "informational") {
    return (
      <li className="greenwood-hollow__item">
        <p className="greenwood-hollow__title">{reward.title}</p>
        {reward.reason ? <p>{reward.reason}</p> : null}
        <p className="muted">
          {reward.status === "acknowledged" ? "acknowledged" : "a word left for you"}
        </p>
      </li>
    );
  }

  return (
    <li className="greenwood-hollow__item">
      <p className="greenwood-hollow__title">{reward.title}</p>
      <p className="muted">{reward.status}</p>
    </li>
  );
}

export function GreenwoodHollow() {
  const { privyReady, loading, authenticated, getAuthHeaders, login } =
    useFennAuth();
  const [rewards, setRewards] = useState<SafeHollowReward[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [leafNote, setLeafNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setRewards([]);
      return;
    }
    const result = await fetchGreenwoodHollow(headers);
    if (!result.ok) {
      setError(result.error.message);
      setRewards([]);
      return;
    }
    setRewards(result.hollow.rewards);
  }, [getAuthHeaders]);

  useEffect(() => {
    if (!privyReady || loading || !authenticated) return;
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [privyReady, loading, authenticated, refresh]);

  async function claim(rewardId: string) {
    setPendingId(rewardId);
    setLeafNote(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const result = await postClaimHollowReward(rewardId, headers);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setLeafNote(`balance ${result.leafBalance} LEAF`);
      await refresh();
    } finally {
      setPendingId(null);
    }
  }

  if (!privyReady || loading) {
    return (
      <article className="place greenwood-hollow-place">
        <p className="muted">the hollow is waking...</p>
      </article>
    );
  }

  if (!authenticated) {
    return (
      <article className="place greenwood-hollow-place">
        <AsciiPageTitle title="THE HOLLOW" mark="HOLLOW" accent="greenwood" />
        <p>sign in to look inside.</p>
        <button type="button" className="btn-text" onClick={() => login()}>
          [ enter ]
        </button>
      </article>
    );
  }

  return (
    <article className="place greenwood-hollow-place">
      <AsciiPageTitle
        title="THE HOLLOW"
        mark="HOLLOW"
        accent="greenwood"
        subtitle={
          <p className="muted">
            what is left here is for you alone.
          </p>
        }
      />

      <p>
        <Link href="/greenwood" className="btn-text">
          [ return to the fire ]
        </Link>
      </p>

      {leafNote ? <p className="muted">{leafNote}</p> : null}
      {error ? <p className="deed-proof__error">{error}</p> : null}

      {rewards == null ? (
        <p className="muted">listening...</p>
      ) : rewards.length === 0 ? (
        <p>Nothing has been left here.</p>
      ) : (
        <ul className="greenwood-hollow__list">
          {rewards.map((reward) => (
            <RewardCard
              key={reward.id}
              reward={reward}
              pending={pendingId === reward.id}
              onClaim={() => {
                void claim(reward.id);
              }}
            />
          ))}
        </ul>
      )}
    </article>
  );
}
