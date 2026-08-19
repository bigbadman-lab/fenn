"use client";

import Link from "next/link";

import { GREENWOOD_GATE_ASCII } from "@/components/greenwood/greenwood-frames";
import { AsciiPageTitle } from "@/components/ui/ascii-page-title";
import type {
  GreenwoodMemberSnapshotView,
  GreenwoodStandingView,
} from "@/lib/greenwood/gate-view";
import {
  formatStandingFraction,
  formatStandingRemainLine,
  formatStandingRequiredLaw,
  ROAD_THRESHOLD_CONTINUATIONS,
  standingFromLifetimeAndThreshold,
} from "@/lib/road/threshold-presentation";
import { CANOPY_DISPLAY } from "@/lib/site/world-vocabulary";

function Continuations(props: {
  showRegister?: boolean;
  showClaimName?: boolean;
  showEarnPaths?: boolean;
  showMap?: boolean;
}) {
  const {
    showRegister = false,
    showClaimName = false,
    showEarnPaths = false,
    showMap = true,
  } = props;

  return (
    <p className="greenwood-gate__continuations" role="navigation" aria-label="continue the road">
      {showRegister ? (
        <Link
          href={ROAD_THRESHOLD_CONTINUATIONS.register.href}
          className="btn-text greenwood-gate__enter-btn"
        >
          {ROAD_THRESHOLD_CONTINUATIONS.register.label}
        </Link>
      ) : null}
      {showClaimName ? (
        <Link
          href={ROAD_THRESHOLD_CONTINUATIONS.claimName.href}
          className="btn-text greenwood-gate__enter-btn"
        >
          {ROAD_THRESHOLD_CONTINUATIONS.claimName.label}
        </Link>
      ) : null}
      {showEarnPaths ? (
        <>
          <Link
            href={ROAD_THRESHOLD_CONTINUATIONS.camp.href}
            className="btn-text greenwood-gate__enter-btn"
          >
            {ROAD_THRESHOLD_CONTINUATIONS.camp.label}
          </Link>
          <Link
            href={ROAD_THRESHOLD_CONTINUATIONS.deeds.href}
            className="btn-text greenwood-gate__enter-btn"
          >
            {ROAD_THRESHOLD_CONTINUATIONS.deeds.label}
          </Link>
        </>
      ) : null}
      {showMap ? (
        <Link
          href={ROAD_THRESHOLD_CONTINUATIONS.map.href}
          className="btn-text greenwood-gate__enter-btn"
        >
          {ROAD_THRESHOLD_CONTINUATIONS.map.label}
        </Link>
      ) : null}
    </p>
  );
}

function StandingBlock({ standing }: { standing: GreenwoodStandingView }) {
  const measurable = standingFromLifetimeAndThreshold(
    standing.lifetimeLeaf,
    standing.threshold,
  );
  return (
    <div className="greenwood-gate__standing">
      <p className="greenwood-gate__standing-label">STANDING</p>
      <p className="greenwood-gate__standing-line">
        {formatStandingFraction(measurable)}
      </p>
      {measurable.remaining > 0 ? (
        <p className="greenwood-gate__standing-remain">
          {formatStandingRemainLine(measurable)}
        </p>
      ) : null}
    </div>
  );
}

type StrangerProps = {
  /** Configured lifetime LEAF threshold; null when not configured. */
  threshold: number | null;
};

/**
 * Constitutional threshold for strangers — law + lore + free road.
 * Does not authenticate; naming is optional until standing is desired permanent.
 */
export function GreenwoodGateStranger({ threshold }: StrangerProps) {
  return (
    <article className="place greenwood-gate">
      <header className="greenwood-gate__header">
        <AsciiPageTitle
          title={CANOPY_DISPLAY.title}
          mark={CANOPY_DISPLAY.mark}
          accent="greenwood"
          subtitle={
            <>
              <p>{CANOPY_DISPLAY.subtitle}</p>
              <p>Entry is earned.</p>
            </>
          }
        />
        <pre className="ascii greenwood-gate__mark" aria-hidden="true">
          {GREENWOOD_GATE_ASCII}
        </pre>
      </header>

      <div className="greenwood-gate__body">
        <p className="greenwood-gate__pause muted">{CANOPY_DISPLAY.remembers}</p>

        <div className="greenwood-gate__explain">
          <p className="greenwood-gate__law-heading">THE LAW</p>
          {threshold != null ? (
            <p>{formatStandingRequiredLaw(threshold)}</p>
          ) : (
            <p className="muted">Standing is not yet written into the Register.</p>
          )}
          <p>LEAF is lifetime standing the wood measures — not spendable coin.</p>
          <p>Nothing is spent to enter.</p>
          <p className="greenwood-gate__pause">
            LEAF is earned through Camp, Deeds, and contribution.
          </p>
          <p>The road is free to explore.</p>
          <p>A name makes your journey permanent.</p>
        </div>

        <p className="muted">
          Claim a name to let the world remember your standing.
        </p>

        <Continuations showRegister showMap />
      </div>
    </article>
  );
}

/**
 * Wallet known, name not yet taken — Register is the honest next step.
 */
export function GreenwoodGateUnnamed({ threshold }: StrangerProps) {
  return (
    <article className="place greenwood-gate">
      <header className="greenwood-gate__header">
        <AsciiPageTitle
          title={CANOPY_DISPLAY.title}
          mark={CANOPY_DISPLAY.mark}
          accent="greenwood"
          subtitle={
            <>
              <p>Your wallet is known.</p>
              <p>Your name is not.</p>
            </>
          }
        />
        <pre className="ascii greenwood-gate__mark" aria-hidden="true">
          {GREENWOOD_GATE_ASCII}
        </pre>
      </header>

      <div className="greenwood-gate__body">
        <p>A wallet alone cannot carry standing here.</p>
        <p>The next honest step is a permanent name in the Register.</p>

        <div className="greenwood-gate__explain">
          <p className="greenwood-gate__law-heading">THE LAW</p>
          {threshold != null ? (
            <p>{formatStandingRequiredLaw(threshold)}</p>
          ) : (
            <p className="muted">Standing is not yet written into the Register.</p>
          )}
          <p>LEAF is earned through Camp, Deeds, and contribution.</p>
          <p>Nothing is spent to enter.</p>
        </div>

        <Continuations showClaimName showEarnPaths showMap />
      </div>
    </article>
  );
}

export function GreenwoodGateListening() {
  return (
    <article
      className="place greenwood-gate greenwood-gate--listening"
      aria-live="polite"
      aria-busy="true"
    >
      <AsciiPageTitle
        title="THE GATE IS LISTENING."
        mark={CANOPY_DISPLAY.mark}
        accent="greenwood"
        subtitle={<p className="muted">the wood is counting.</p>}
      />
    </article>
  );
}

type IneligibleProps = {
  standing: GreenwoodStandingView;
};

export function GreenwoodGateIneligible({ standing }: IneligibleProps) {
  return (
    <article
      className="place greenwood-gate greenwood-gate--refused"
      aria-live="polite"
    >
      <AsciiPageTitle
        title={CANOPY_DISPLAY.title}
        mark={CANOPY_DISPLAY.mark}
        accent="greenwood"
        subtitle={
          <>
            <p>the road does not open for everyone.</p>
            <p className="muted">{CANOPY_DISPLAY.remembers}</p>
          </>
        }
      />
      <div className="greenwood-gate__body">
        <StandingBlock standing={standing} />

        <div className="greenwood-gate__explain">
          <p className="greenwood-gate__law-heading">THE LAW</p>
          <p>{formatStandingRequiredLaw(standing.threshold)}</p>
          <p>LEAF is not spent.</p>
          <p>Standing measures what the world remembers.</p>
          <p>NOTHING IS SPENT HERE.</p>
        </div>

        <p className="greenwood-gate__pause">
          Earn more standing through honest work on the road.
        </p>

        <Continuations showEarnPaths showMap />
      </div>
    </article>
  );
}

type EligibleProps = {
  standing: GreenwoodStandingView;
  enterDisabled: boolean;
  entering: boolean;
  onCross: () => void;
};

export function GreenwoodGateEligible({
  standing,
  enterDisabled,
  entering,
  onCross,
}: EligibleProps) {
  return (
    <article className="place greenwood-gate" aria-live="polite">
      <AsciiPageTitle
        title={CANOPY_DISPLAY.title}
        mark={CANOPY_DISPLAY.mark}
        accent="greenwood"
        subtitle={
          <>
            <p>You have reached the standing required.</p>
            <p>{CANOPY_DISPLAY.nowOpens}</p>
          </>
        }
      />
      <div className="greenwood-gate__body">
        <StandingBlock standing={standing} />

        <div className="greenwood-gate__explain">
          <p className="greenwood-gate__law-heading">THE LAW</p>
          <p>{formatStandingRequiredLaw(standing.threshold)}</p>
          <p>LEAF is not spent to cross.</p>
          <p className="muted">The wood knows why they stand beside your name.</p>
        </div>

        <p className="greenwood-gate__enter">
          <button
            type="button"
            className="btn-text greenwood-gate__enter-btn"
            onClick={onCross}
            disabled={enterDisabled || entering}
            aria-busy={entering || undefined}
          >
            [ CROSS ]
          </button>
        </p>
        {entering ? (
          <p className="muted" role="status">
            the wood is parting...
          </p>
        ) : null}
      </div>
    </article>
  );
}

type MemberProps = {
  outlawLabel: string;
  member: GreenwoodMemberSnapshotView;
  newlyAdmitted: boolean;
  onContinue: () => void;
};

/** Legacy mid-admission screen — gateway uses arrival ceremony instead. */
export function GreenwoodGateMember({
  outlawLabel,
  member,
  newlyAdmitted,
  onContinue,
}: MemberProps) {
  return (
    <article
      className="place greenwood-gate greenwood-gate--admitted"
      aria-live="polite"
    >
      <AsciiPageTitle
        title={newlyAdmitted ? CANOPY_DISPLAY.gateOpens : CANOPY_DISPLAY.knowsYou}
        mark={CANOPY_DISPLAY.mark}
        accent="greenwood"
        subtitle={
          <>
            <p>{outlawLabel}</p>
            {newlyAdmitted ? (
              <p>{CANOPY_DISPLAY.crossed}</p>
            ) : (
              <p>
                entered with {member.lifetimeLeafAtEntry} lifetime LEAF.
              </p>
            )}
          </>
        }
      />
      <div className="greenwood-gate__body">
        {newlyAdmitted ? (
          <p className="muted">
            entered with {member.lifetimeLeafAtEntry} lifetime LEAF.
          </p>
        ) : null}
        <p className="greenwood-gate__enter">
          <button
            type="button"
            className="btn-text greenwood-gate__enter-btn"
            onClick={onContinue}
          >
            [ CONTINUE ]
          </button>
        </p>
      </div>
    </article>
  );
}

type ErrorProps = {
  onRetry: () => void;
  retryPending?: boolean;
};

export function GreenwoodGateStatusError({
  onRetry,
  retryPending = false,
}: ErrorProps) {
  return (
    <article
      className="place greenwood-gate greenwood-gate--listening"
      aria-live="polite"
    >
      <AsciiPageTitle
        title="THE GATE CANNOT HEAR YOU."
        mark={CANOPY_DISPLAY.mark}
        accent="greenwood"
        subtitle={<p>something in the wood went quiet.</p>}
      />
      <div className="greenwood-gate__body">
        <p className="greenwood-gate__enter">
          <button
            type="button"
            className="btn-text greenwood-gate__enter-btn"
            onClick={onRetry}
            disabled={retryPending}
            aria-busy={retryPending || undefined}
          >
            [ TRY AGAIN ]
          </button>
        </p>
        <Continuations showEarnPaths showMap />
      </div>
    </article>
  );
}

export function GreenwoodGateEnterError({
  onRetry,
  retryPending = false,
}: ErrorProps) {
  return (
    <article className="place greenwood-gate" aria-live="polite">
      <AsciiPageTitle
        title="THE GATE DID NOT OPEN."
        mark={CANOPY_DISPLAY.mark}
        accent="greenwood"
        subtitle={<p>the wood held its breath.</p>}
      />
      <div className="greenwood-gate__body">
        <p className="greenwood-gate__enter">
          <button
            type="button"
            className="btn-text greenwood-gate__enter-btn"
            onClick={onRetry}
            disabled={retryPending}
            aria-busy={retryPending || undefined}
          >
            [ TRY AGAIN ]
          </button>
        </p>
        <Continuations showEarnPaths showMap />
      </div>
    </article>
  );
}
