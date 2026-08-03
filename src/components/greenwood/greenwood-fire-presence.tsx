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
  GREENWOOD_FIRE_TITLE_MARK,
  formatFireWaitingOverflow,
  type FireAsciiLine,
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
  let lines: FireAsciiLine[] = GREENWOOD_FIRE_CLEARING_LISTENING;
  let description = GREENWOOD_FIRE_A11Y_LISTENING;
  if (mode === "waiting") {
    lines = narrow
      ? GREENWOOD_FIRE_CLEARING_WAITING_MOBILE
      : GREENWOOD_FIRE_CLEARING_WAITING_DESKTOP;
    description = GREENWOOD_FIRE_A11Y_WAITING;
  } else if (mode === "seated") {
    lines = narrow
      ? GREENWOOD_FIRE_CLEARING_SEATED_MOBILE
      : GREENWOOD_FIRE_CLEARING_SEATED_DESKTOP;
    description = GREENWOOD_FIRE_A11Y_SEATED;
  }

  const toneClass = (tone: FireAsciiLine["tone"]) => {
    if (tone === "ember") return "greenwood-fire-presence__ascii-line--ember";
    if (tone === "ash") return "greenwood-fire-presence__ascii-line--ash";
    if (tone === "greenwood") {
      return "greenwood-fire-presence__ascii-line--greenwood";
    }
    return "greenwood-fire-presence__ascii-line--bone";
  };

  return (
    <div className="greenwood-fire-presence__scene">
      <p className="visually-hidden">{description}</p>
      <div
        className={
          mode === "seated"
            ? "ascii greenwood-fire-presence__clearing greenwood-fire-presence__clearing--seated"
            : mode === "listening"
              ? "ascii greenwood-fire-presence__clearing greenwood-fire-presence__clearing--listening"
              : "ascii greenwood-fire-presence__clearing greenwood-fire-presence__clearing--waiting"
        }
        aria-hidden="true"
      >
        {lines.map((line, index) => (
          <div
            key={`${mode}-${index}`}
            className={`greenwood-fire-presence__ascii-line ${toneClass(line.tone)}`}
          >
            {line.text || " "}
          </div>
        ))}
      </div>
    </div>
  );
}

function MemberMark({
  member,
  variant,
}: {
  member: FirePresenceMember;
  variant: "ring" | "warm" | "self";
}) {
  const sigilClass =
    variant === "self"
      ? "ascii greenwood-fire-presence__self-sigil"
      : variant === "ring"
        ? "ascii greenwood-fire-presence__ring-sigil"
        : "ascii greenwood-fire-presence__sigil";

  return (
    <div
      className={
        variant === "self"
          ? "greenwood-fire-presence__self"
          : variant === "ring"
            ? "greenwood-fire-presence__ring-member"
            : "greenwood-fire-presence__member"
      }
    >
      {member.sigil ? (
        <pre className={sigilClass} aria-label={member.sigil.a11yLabel}>
          {member.sigil.asciiBody}
        </pre>
      ) : (
        <p className="muted greenwood-fire-presence__sigil-fallback">
          unmarked
        </p>
      )}
      {variant === "self" ? (
        <>
          <p className="greenwood-fire-presence__you-here">YOU ARE HERE</p>
          <p className="greenwood-fire-presence__self-name">
            {member.displayName}
          </p>
          <p className="muted greenwood-fire-presence__self-outlaw">
            {member.outlawLabel}
          </p>
        </>
      ) : (
        <>
          <p className="greenwood-fire-presence__name">{member.displayName}</p>
          {variant === "ring" ? (
            <p className="muted greenwood-fire-presence__waiting-tag">waiting</p>
          ) : (
            <p className="muted greenwood-fire-presence__waiting-tag">warm</p>
          )}
        </>
      )}
    </div>
  );
}

function OpenPlace() {
  return (
    <li className="greenwood-fire-presence__open-place" aria-hidden="false">
      <p className="greenwood-fire-presence__open-place-mark">A PLACE</p>
      <p className="greenwood-fire-presence__open-place-mark">AWAITS YOU</p>
    </li>
  );
}

function InvitationCopy() {
  return (
    <div className="greenwood-fire-presence__purpose">
      <p>Those who sit here are considered present in the Greenwood.</p>
      <p className="muted">
        When FENN calls, a Gathering begins, or something stirs beneath the
        trees, those already waiting may be called first.
      </p>
      <p className="muted">Leave whenever you wish.</p>
    </div>
  );
}

function WaitingRing({
  waiting,
  limit,
  showOpenPlace,
}: {
  waiting: FirePresenceMember[];
  limit: number;
  showOpenPlace: boolean;
}) {
  const shown = waiting.slice(0, limit);
  const overflow = waiting.length - shown.length;
  if (!showOpenPlace && shown.length === 0) return null;

  return (
    <div
      className="greenwood-fire-presence__ring"
      aria-label="Waiting by the Fire"
    >
      <h3 className="greenwood-fire-presence__group-title">
        WAITING BY THE FIRE
      </h3>
      <ul className="greenwood-fire-presence__ring-list">
        {shown.map((member) => (
          <li key={member.outlawLabel}>
            <MemberMark member={member} variant="ring" />
          </li>
        ))}
        {showOpenPlace ? <OpenPlace /> : null}
      </ul>
      {overflow > 0 ? (
        <p className="greenwood-fire-presence__overflow">
          {formatFireWaitingOverflow(overflow)}
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
  const waitingMembers = others.filter((m) => m.sitting);
  const warmMembers = others.filter((m) => !m.sitting);
  const selfMember = members.find((m) => m.isSelf) ?? null;

  const quiet = !sitting && waitingMembers.length === 0;
  const gathered = waitingMembers.length > 0 || sitting;

  let stateLead = "THE FIRE WAITS";
  let stateDetail: ReactNode = (
    <p className="muted">No marks wait here yet.</p>
  );
  if (sitting) {
    stateLead = "THE FIRE KNOWS YOU ARE HERE";
    stateDetail = (
      <>
        <p>Your place is held.</p>
        <p className="muted">
          If the Greenwood calls, you will be counted among those waiting.
        </p>
      </>
    );
  } else if (waitingMembers.length > 0) {
    stateLead = "OTHERS ARE ALREADY WAITING";
    stateDetail = (
      <>
        <p className="muted">
          {waitingMembers.length} mark
          {waitingMembers.length === 1 ? " is" : "s are"} already here.
        </p>
        <p className="muted">Sit to join them.</p>
      </>
    );
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
        <p className="muted greenwood-fire-presence__status-copy">
          the Fire is listening...
        </p>
      </>
    );
  } else if (status === "error" && !presence) {
    body = (
      <>
        <FireAsciiScene mode="waiting" narrow={narrow} />
        <p className="muted greenwood-fire-presence__status-copy">
          the marks cannot be read just now.
        </p>
        <p className="muted greenwood-fire-presence__status-copy">
          the rest of the Greenwood remains open.
        </p>
      </>
    );
  } else if (sitting) {
    body = (
      <>
        <InvitationCopy />
        <FireAsciiScene mode="seated" narrow={narrow} />
        <p className="greenwood-fire-presence__state-lead">{stateLead}</p>
        {stateDetail}
        {selfMember ? (
          <MemberMark member={selfMember} variant="self" />
        ) : (
          <div className="greenwood-fire-presence__self">
            <p className="muted greenwood-fire-presence__sigil-fallback">
              unmarked
            </p>
            <p className="greenwood-fire-presence__you-here">YOU ARE HERE</p>
          </div>
        )}
        <WaitingRing
          waiting={waitingMembers}
          limit={waitingLimit}
          showOpenPlace={false}
        />
        {warmMembers.length > 0 ? (
          <>
            <h3 className="greenwood-fire-presence__group-title">
              MARKS STILL WARM
            </h3>
            <ul className="greenwood-fire-presence__list">
              {warmMembers.map((member) => (
                <li key={member.outlawLabel}>
                  <MemberMark member={member} variant="warm" />
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <p className="muted greenwood-fire-presence__closing">
          The Fire sees you. The Greenwood remembers.
        </p>
      </>
    );
  } else {
    body = (
      <>
        <InvitationCopy />
        <FireAsciiScene mode="waiting" narrow={narrow} />
        <p className="greenwood-fire-presence__state-lead">{stateLead}</p>
        {stateDetail}
        <WaitingRing
          waiting={waitingMembers}
          limit={waitingLimit}
          showOpenPlace
        />
        {warmMembers.length > 0 ? (
          <>
            <h3 className="greenwood-fire-presence__group-title">
              MARKS STILL WARM
            </h3>
            <ul className="greenwood-fire-presence__list">
              {warmMembers.map((member) => (
                <li key={member.outlawLabel}>
                  <MemberMark member={member} variant="warm" />
                </li>
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
        className="greenwood-member__section-title greenwood-member__section-title--fire greenwood-fire-presence__heading"
      >
        <span className="greenwood-fire-presence__heading-mark" aria-hidden="true">
          {GREENWOOD_FIRE_TITLE_MARK}
        </span>
        <span className="greenwood-fire-presence__heading-text">AT THE FIRE</span>
      </h2>
      <p className="greenwood-fire-presence__heading-rule" aria-hidden="true">
        +------------------------------+
      </p>

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
          <>
            {status !== "loading" || presence ? (
              <p className="muted greenwood-fire-presence__action-hint">
                Make your mark. Sit by the Fire.
              </p>
            ) : null}
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
          </>
        )}
      </div>
    </section>
  );
}
