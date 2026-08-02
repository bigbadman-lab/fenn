"use client";

import { useEffect, useState, type ReactNode } from "react";

import {
  GREENWOOD_FIRE_A11Y_LISTENING,
  GREENWOOD_FIRE_A11Y_SEATED,
  GREENWOOD_FIRE_A11Y_WAITING,
  GREENWOOD_FIRE_CLEARING_LISTENING,
  GREENWOOD_FIRE_CLEARING_SEATED_DESKTOP,
  GREENWOOD_FIRE_CLEARING_SEATED_MOBILE,
  GREENWOOD_FIRE_CLEARING_WAITING_DESKTOP,
  GREENWOOD_FIRE_CLEARING_WAITING_LIMIT,
  GREENWOOD_FIRE_CLEARING_WAITING_LIMIT_NARROW,
  GREENWOOD_FIRE_CLEARING_WAITING_MOBILE,
} from "@/components/greenwood/greenwood-fire-frames";
import { useGreenwoodFirePresence } from "@/hooks/use-greenwood-fire-presence";
import type { FirePresenceMember } from "@/lib/greenwood/presence/types";

type GreenwoodFirePresenceProps = {
  getAuthHeaders: () => Promise<HeadersInit | null>;
};

function useNarrowFireScene(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 40rem)");
    const apply = () => setNarrow(query.matches);
    const timer = window.setTimeout(apply, 0);
    query.addEventListener("change", apply);
    return () => {
      window.clearTimeout(timer);
      query.removeEventListener("change", apply);
    };
  }, []);
  return narrow;
}

function FireAsciiScene({
  mode,
  narrow,
}: {
  mode: "waiting" | "seated" | "listening";
  narrow: boolean;
}) {
  let art = GREENWOOD_FIRE_CLEARING_LISTENING;
  let description = GREENWOOD_FIRE_A11Y_LISTENING;
  if (mode === "waiting") {
    art = narrow
      ? GREENWOOD_FIRE_CLEARING_WAITING_MOBILE
      : GREENWOOD_FIRE_CLEARING_WAITING_DESKTOP;
    description = GREENWOOD_FIRE_A11Y_WAITING;
  } else if (mode === "seated") {
    art = narrow
      ? GREENWOOD_FIRE_CLEARING_SEATED_MOBILE
      : GREENWOOD_FIRE_CLEARING_SEATED_DESKTOP;
    description = GREENWOOD_FIRE_A11Y_SEATED;
  }

  return (
    <div className="greenwood-fire-presence__scene">
      <p className="visually-hidden">{description}</p>
      <pre
        className={
          mode === "seated"
            ? "ascii greenwood-fire-presence__clearing greenwood-fire-presence__clearing--seated"
            : mode === "listening"
              ? "ascii greenwood-fire-presence__clearing greenwood-fire-presence__clearing--listening"
              : "ascii greenwood-fire-presence__clearing greenwood-fire-presence__clearing--waiting"
        }
        aria-hidden="true"
      >
        {art}
      </pre>
    </div>
  );
}

function WaitingRingMember({ member }: { member: FirePresenceMember }) {
  return (
    <li className="greenwood-fire-presence__ring-member">
      {member.sigil ? (
        <pre
          className="ascii greenwood-fire-presence__ring-sigil"
          aria-label={member.sigil.a11yLabel}
        >
          {member.sigil.asciiBody}
        </pre>
      ) : (
        <p className="muted greenwood-fire-presence__sigil-fallback">
          unmarked
        </p>
      )}
      <p className="greenwood-fire-presence__name">{member.displayName}</p>
    </li>
  );
}

function WarmMemberRow({ member }: { member: FirePresenceMember }) {
  return (
    <li className="greenwood-fire-presence__member">
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
      <p className="greenwood-fire-presence__name">{member.displayName}</p>
      <p className="muted greenwood-fire-presence__waiting-tag">warm</p>
    </li>
  );
}

function InvitationCopy() {
  return (
    <>
      <p>
        Those who sit here are considered present in the Greenwood.
      </p>
      <p className="muted">
        When FENN calls, a Gathering begins, or something stirs beneath the
        trees, those already waiting may be called first.
      </p>
      <p className="muted">Leave whenever you wish.</p>
    </>
  );
}

function WaitingRing({
  waiting,
  limit,
}: {
  waiting: FirePresenceMember[];
  limit: number;
}) {
  if (waiting.length === 0) return null;
  const shown = waiting.slice(0, limit);
  const overflow = waiting.length - shown.length;

  return (
    <div className="greenwood-fire-presence__ring" aria-label="Waiting by the Fire">
      <h3 className="greenwood-fire-presence__group-title">
        WAITING BY THE FIRE
      </h3>
      <ul className="greenwood-fire-presence__ring-list">
        {shown.map((member) => (
          <WaitingRingMember key={member.outlawLabel} member={member} />
        ))}
      </ul>
      {overflow > 0 ? (
        <p className="greenwood-fire-presence__overflow">
          + {overflow} OTHER MARK{overflow === 1 ? "" : "S"} WAIT BEYOND THE
          FIRELIGHT
        </p>
      ) : null}
    </div>
  );
}

/**
 * Living Greenwood 2 — AT THE FIRE presence clearing.
 * Visual composition only; sit/leave remain server-authoritative.
 */
export function GreenwoodFirePresence({
  getAuthHeaders,
}: GreenwoodFirePresenceProps) {
  const { status, presence, actionPending, actionError, sit, leave } =
    useGreenwoodFirePresence({ getAuthHeaders });
  const narrow = useNarrowFireScene();
  const waitingLimit = narrow
    ? GREENWOOD_FIRE_CLEARING_WAITING_LIMIT_NARROW
    : GREENWOOD_FIRE_CLEARING_WAITING_LIMIT;

  const sitting = presence?.self.sitting ?? false;
  const members = presence?.members ?? [];
  const others = members.filter((m) => !m.isSelf);
  const waitingOthers = others.filter((m) => m.sitting);
  const warmOthers = others.filter((m) => !m.sitting);
  const selfMember = members.find((m) => m.isSelf) ?? null;
  const otherWarmCount = others.length;

  const quiet = !sitting && waitingOthers.length === 0;
  const gathered = waitingOthers.length > 0 || sitting;

  let stateLead = "THE FIRE WAITS";
  if (sitting) {
    stateLead = "THE FIRE KNOWS YOU ARE HERE";
  } else if (waitingOthers.length > 0) {
    stateLead = "OTHERS ARE ALREADY WAITING";
  }

  const sectionClass = [
    "greenwood-interior__section",
    "greenwood-fire-presence",
    sitting
      ? "greenwood-fire-presence--seated"
      : "greenwood-fire-presence--waiting",
    quiet ? "greenwood-fire-presence--quiet" : "",
    gathered ? "greenwood-fire-presence--gathered" : "",
    status === "error" && !presence
      ? "greenwood-fire-presence--subdued"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  let body: ReactNode;

  if (status === "loading" && !presence) {
    body = (
      <>
        <FireAsciiScene mode="listening" narrow={narrow} />
        <p className="muted">the Fire is listening...</p>
      </>
    );
  } else if (status === "error" && !presence) {
    body = (
      <>
        <FireAsciiScene mode="waiting" narrow={narrow} />
        <p className="muted">the marks cannot be read just now.</p>
        <p className="muted">the rest of the Greenwood remains open.</p>
      </>
    );
  } else if (sitting) {
    body = (
      <>
        <FireAsciiScene mode="seated" narrow={narrow} />
        <p className="greenwood-fire-presence__state-lead">{stateLead}</p>
        <p>Your place is held.</p>
        <p className="muted">
          If the Greenwood calls, you will be counted among those waiting.
        </p>

        <div className="greenwood-fire-presence__self">
          {selfMember?.sigil ? (
            <pre
              className="ascii greenwood-fire-presence__self-sigil"
              aria-label={selfMember.sigil.a11yLabel}
            >
              {selfMember.sigil.asciiBody}
            </pre>
          ) : (
            <p className="muted greenwood-fire-presence__sigil-fallback">
              unmarked
            </p>
          )}
          <p className="greenwood-fire-presence__you-here">YOU ARE HERE</p>
          <p className="greenwood-fire-presence__self-name">
            {selfMember?.displayName ?? "OUTLAW"}
          </p>
        </div>

        <WaitingRing waiting={waitingOthers} limit={waitingLimit} />

        {otherWarmCount > 0 ? (
          <p className="greenwood-fire-presence__count">
            {otherWarmCount} OTHER MARK{otherWarmCount === 1 ? "" : "S"} REMAIN
            WARM
          </p>
        ) : (
          <p className="muted">No other marks remain near.</p>
        )}

        {warmOthers.length > 0 ? (
          <>
            <h3 className="greenwood-fire-presence__group-title">
              MARKS STILL WARM
            </h3>
            <ul className="greenwood-fire-presence__list">
              {warmOthers.map((member) => (
                <WarmMemberRow key={member.outlawLabel} member={member} />
              ))}
            </ul>
          </>
        ) : null}
      </>
    );
  } else {
    body = (
      <>
        <FireAsciiScene mode="waiting" narrow={narrow} />
        <p className="greenwood-fire-presence__state-lead">{stateLead}</p>
        <InvitationCopy />
        <WaitingRing waiting={waitingOthers} limit={waitingLimit} />
        {warmOthers.length > 0 || (selfMember && !selfMember.sitting) ? (
          <>
            <h3 className="greenwood-fire-presence__group-title">
              MARKS STILL WARM
            </h3>
            <ul className="greenwood-fire-presence__list">
              {selfMember && !selfMember.sitting ? (
                <WarmMemberRow
                  key={selfMember.outlawLabel}
                  member={selfMember}
                />
              ) : null}
              {warmOthers.map((member) => (
                <WarmMemberRow key={member.outlawLabel} member={member} />
              ))}
            </ul>
          </>
        ) : null}
      </>
    );
  }

  return (
    <section
      id="the-fire"
      className={sectionClass}
      aria-labelledby="gf-at-fire"
    >
      <h2
        id="gf-at-fire"
        className="greenwood-member__section-title greenwood-member__section-title--fire"
      >
        AT THE FIRE
      </h2>
      {body}

      {actionError ? (
        <p className="muted greenwood-fire-presence__action-error" role="status">
          {actionError}
        </p>
      ) : null}

      <div className="greenwood-fire-presence__actions">
        {sitting ? (
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
