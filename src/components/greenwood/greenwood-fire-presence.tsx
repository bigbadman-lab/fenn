"use client";

import type { ReactNode } from "react";

import { useGreenwoodFirePresence } from "@/hooks/use-greenwood-fire-presence";
import type { FirePresenceMember } from "@/lib/greenwood/presence/types";

type GreenwoodFirePresenceProps = {
  getAuthHeaders: () => Promise<HeadersInit | null>;
};

function PresenceMemberRow({ member }: { member: FirePresenceMember }) {
  return (
    <li
      className={
        member.sitting
          ? "greenwood-fire-presence__member greenwood-fire-presence__member--sitting"
          : "greenwood-fire-presence__member"
      }
    >
      {member.sigil ? (
        <pre
          className="ascii greenwood-fire-presence__sigil"
          aria-label={member.sigil.a11yLabel}
        >
          {member.sigil.asciiBody}
        </pre>
      ) : (
        <p className="muted greenwood-fire-presence__sigil-fallback">
          unmarked
        </p>
      )}
      <p className="greenwood-fire-presence__name">
        {member.displayName}
        {member.isSelf ? (
          <span className="muted"> · you</span>
        ) : null}
        {member.sitting ? (
          <span className="greenwood-fire-presence__sitting-tag">
            {" "}
            · sitting
          </span>
        ) : null}
      </p>
    </li>
  );
}

/**
 * Living Greenwood 2 — AT THE FIRE presence section.
 * Heartbeat + sit/leave only. No gatherings or rewards.
 */
export function GreenwoodFirePresence({
  getAuthHeaders,
}: GreenwoodFirePresenceProps) {
  const { status, presence, actionPending, sit, leave } =
    useGreenwoodFirePresence({ getAuthHeaders });

  const sitting = presence?.self.sitting ?? false;
  const members = presence?.members ?? [];
  const activeCount = presence?.activeCount ?? 0;

  let body: ReactNode;
  if (status === "loading" && !presence) {
    body = <p className="muted">the Fire is listening...</p>;
  } else if (status === "error" && !presence) {
    body = (
      <>
        <p className="muted">the marks cannot be read just now.</p>
        <p className="muted">the rest of the Greenwood remains open.</p>
      </>
    );
  } else if (activeCount === 0) {
    body = (
      <>
        <p>The Fire is quiet.</p>
        <p className="muted">
          Those whose marks remain warm are near the Fire.
        </p>
      </>
    );
  } else if (activeCount === 1 && members[0]?.isSelf) {
    body = (
      <>
        <p>
          {sitting
            ? "You sit alone by the Fire."
            : "Your mark is warm. No other marks remain near."}
        </p>
        <ul className="greenwood-fire-presence__list">
          {members.map((member) => (
            <PresenceMemberRow key={member.outlawLabel} member={member} />
          ))}
        </ul>
      </>
    );
  } else {
    body = (
      <>
        <p className="muted">
          Those whose marks remain warm are near the Fire.
        </p>
        <p className="greenwood-fire-presence__count">
          {activeCount} mark{activeCount === 1 ? "" : "s"} remain warm
        </p>
        <ul className="greenwood-fire-presence__list">
          {members.map((member) => (
            <PresenceMemberRow key={member.outlawLabel} member={member} />
          ))}
        </ul>
      </>
    );
  }

  return (
    <section
      className="greenwood-interior__section greenwood-fire-presence"
      aria-labelledby="gf-at-fire"
    >
      <h2
        id="gf-at-fire"
        className="greenwood-member__section-title greenwood-member__section-title--fire"
      >
        AT THE FIRE
      </h2>
      {body}

      <div className="greenwood-fire-presence__actions">
        {sitting ? (
          <>
            <p className="greenwood-fire-presence__self-state">
              YOU ARE SITTING BY THE FIRE
            </p>
            <button
              type="button"
              className="greenwood-fire-presence__btn"
              disabled={actionPending}
              onClick={() => {
                void leave();
              }}
            >
              {actionPending ? "[ LEAVING… ]" : "[ LEAVE THE FIRE ]"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="greenwood-fire-presence__btn"
            disabled={actionPending || status === "loading"}
            onClick={() => {
              void sit();
            }}
          >
            {actionPending ? "[ SITTING… ]" : "[ SIT BY THE FIRE ]"}
          </button>
        )}
      </div>
    </section>
  );
}
