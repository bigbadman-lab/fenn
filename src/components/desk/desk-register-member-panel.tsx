"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useDeskGate } from "@/components/desk/desk-gate";
import type {
  DeskPresenceState,
  DeskRegisterMemberDetail,
} from "@/lib/desk/register-types";

function presenceLabel(state: DeskPresenceState): string {
  switch (state) {
    case "at_the_fire":
      return "AT THE FIRE";
    case "sitting":
      return "SITTING";
    case "recently_warm":
      return "RECENTLY WARM";
    default:
      return "NOT PRESENT";
  }
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function DeskRegisterMemberPanel({ profileId }: { profileId: string }) {
  const { getAuthHeaders } = useDeskGate();
  const [member, setMember] = useState<DeskRegisterMemberDetail | null>(null);
  const [error, setError] = useState<"not_found" | "load" | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    const headers = await getAuthHeaders();
    if (!headers) {
      setMember(null);
      setError("load");
      setLoading(false);
      return;
    }
    try {
      const response = await fetch(`/api/desk/register/${profileId}`, {
        headers,
        cache: "no-store",
      });
      if (response.status === 404) {
        setMember(null);
        setError("not_found");
        setLoading(false);
        return;
      }
      if (!response.ok) {
        setMember(null);
        setError("load");
        setLoading(false);
        return;
      }
      const data = (await response.json()) as {
        ok?: boolean;
        member?: DeskRegisterMemberDetail;
      };
      setMember(data.member ?? null);
      setLoading(false);
    } catch {
      setMember(null);
      setError("load");
      setLoading(false);
    }
  }, [getAuthHeaders, profileId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function onCopy() {
    if (!member) return;
    const ok = await copyText(member.walletAddress);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  }

  if (loading && !member) {
    return <p className="muted">…</p>;
  }

  if (error === "not_found") {
    return (
      <section>
        <p className="muted">No such profile.</p>
        <Link href="/desk/register" className="btn-text">
          [ back to The Register ]
        </Link>
      </section>
    );
  }

  if (error || !member) {
    return <p className="muted">This member could not be opened.</p>;
  }

  return (
    <section className="desk-member" aria-label={member.displayName}>
      <p>
        <Link href="/desk/register" className="btn-text">
          [ back to The Register ]
        </Link>
        <button type="button" className="btn-text" onClick={() => void load()}>
          [ refresh ]
        </button>
      </p>

      <h2 className="desk-section-title">{member.displayName}</h2>
      <p className="muted">#{member.outlawNumberLabel}</p>

      <p className="desk-divider" aria-hidden>
        ────────────────────
      </p>

      <h3 className="desk-overview__group-title">IDENTITY</h3>
      {member.sigil ? (
        <pre className="ascii desk__sigil" aria-label={member.sigil.a11yLabel}>
          {member.sigil.asciiBody}
        </pre>
      ) : (
        <p className="muted">unmarked</p>
      )}
      <ul className="desk-member__facts">
        <li>
          Linked wallet: <code title={member.walletAddress}>{member.walletShort}</code>
        </li>
        <li>
          <button type="button" className="btn-text" onClick={() => void onCopy()}>
            {copied ? "[ COPIED ]" : "[ COPY WALLET ]"}
          </button>
          {member.explorerUrl ? (
            <a
              href={member.explorerUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="btn-text"
            >
              [ RH CHAIN ]
            </a>
          ) : null}
        </li>
        <li>X: {member.xHandle ? `@${member.xHandle}` : "—"}</li>
        <li>Joined: {member.joinedAt.slice(0, 10)}</li>
        <li>Fire: {presenceLabel(member.presence)}</li>
      </ul>

      <h3 className="desk-overview__group-title">STANDING</h3>
      <ul className="desk-member__facts">
        <li>LEAF: {member.leafBalance}</li>
        <li>Lifetime: {member.leafLifetimeEarned}</li>
        <li>Standing: {member.standingLabel}</li>
        <li>Greenwood: {member.greenwoodMember ? "yes" : "no"}</li>
        <li>
          Admitted:{" "}
          {member.greenwoodEnteredAt
            ? member.greenwoodEnteredAt.slice(0, 10)
            : "—"}
        </li>
      </ul>

      <p>
        <Link
          href={`/desk/hollow?profile=${member.profileId}`}
          className="btn-text"
        >
          [ create Hollow campaign ]
        </Link>
      </p>

      <h3 className="desk-overview__group-title">RECENT DEEDS</h3>
      {member.recentDeeds.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ul className="desk-member__list">
          {member.recentDeeds.map((d) => (
            <li key={d.submissionId}>
              {d.deedTitle} · {d.status} · {d.submittedAt.slice(0, 10)}
              {d.leafAwarded != null ? ` · ${d.leafAwarded} LEAF` : ""}
            </li>
          ))}
        </ul>
      )}

      <h3 className="desk-overview__group-title">RECENT HANDS</h3>
      {member.recentGatheringHands.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ul className="desk-member__list">
          {member.recentGatheringHands.map((h) => (
            <li key={`${h.gatheringId}-${h.raisedAt}`}>
              {h.title} · {h.handOpen ? "raised" : "lowered"} ·{" "}
              {h.raisedAt.slice(0, 10)}
            </li>
          ))}
        </ul>
      )}

      <h3 className="desk-overview__group-title">RECENT HOLLOW</h3>
      {member.recentHollow.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ul className="desk-member__list">
          {member.recentHollow.map((h) => (
            <li key={h.rewardId}>
              {h.title} · {h.rewardType}
              {h.amount != null ? ` · ${h.amount}` : ""} · {h.status}
            </li>
          ))}
        </ul>
      )}

      <h3 className="desk-overview__group-title">RECENT LEAF</h3>
      {member.recentLedger.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ul className="desk-member__list">
          {member.recentLedger.map((e) => (
            <li key={e.id}>
              {e.amount} · {e.sourceType} · {e.reason} ·{" "}
              {e.createdAt.slice(0, 10)}
            </li>
          ))}
        </ul>
      )}

      <h3 className="desk-overview__group-title">CAMP</h3>
      <ul className="desk-member__facts">
        <li>Sessions: {member.camp.sessionCount}</li>
        <li>Messages: {member.camp.totalMessages}</li>
        <li>
          Last message:{" "}
          {member.camp.lastMessageAt
            ? member.camp.lastMessageAt.slice(0, 10)
            : "—"}
        </li>
      </ul>

      <h3 className="desk-overview__group-title">THE FIRST THIRTY</h3>
      <ul className="desk-member__facts">
        <li>Status: {member.firstThirty.status}</li>
        <li>
          Eligible Camp exchanges: {member.firstThirty.eligibleCampExchanges}
        </li>
        <li>
          Milestones: camp_first{" "}
          {member.firstThirty.milestones.firstCamp ? "✓" : "—"} · camp_three{" "}
          {member.firstThirty.milestones.thirdCamp ? "✓" : "—"} · first_deed{" "}
          {member.firstThirty.milestones.firstDeed ? "✓" : "—"}
        </li>
        <li>
          Onboarding LEAF granted: {member.firstThirty.onboardingLeafGranted}
        </li>
        <li>
          Lifetime LEAF: {member.firstThirty.lifetimeLeaf} · Until Greenwood:{" "}
          {member.firstThirty.leafUntilGreenwood}
        </li>
        <li>
          Greenwood open:{" "}
          {member.firstThirty.greenwoodOpen ? "yes" : "no"}
        </li>
      </ul>
    </section>
  );
}
