"use client";

import { GREENWOOD_GATE_ASCII } from "@/components/greenwood/greenwood-frames";
import { AsciiPageTitle } from "@/components/ui/ascii-page-title";
import type {
  GreenwoodMemberSnapshotView,
  GreenwoodStandingView,
} from "@/lib/greenwood/gate-view";

type GreenwoodGatePublicProps = {
  enterDisabled: boolean;
  enterPending: boolean;
  onEnter: () => void;
};

/** Public gate — logged out / unregistered / auth settling. */
export function GreenwoodGate({
  enterDisabled,
  enterPending,
  onEnter,
}: GreenwoodGatePublicProps) {
  return (
    <article className="place greenwood-gate">
      <header className="greenwood-gate__header">
        <AsciiPageTitle
          title="THE GREENWOOD"
          mark="GREENWOOD"
          accent="greenwood"
          subtitle={
            <>
              <p>the road was free.</p>
              <p>this part was not.</p>
            </>
          }
        />
        <pre className="ascii greenwood-gate__mark" aria-hidden="true">
          {GREENWOOD_GATE_ASCII}
        </pre>
      </header>

      <div className="greenwood-gate__body">
        <p className="greenwood-gate__pause">something moves beyond the trees.</p>
        <p>the wood is open.</p>
        <p>are you?</p>

        <p className="greenwood-gate__enter">
          <button
            type="button"
            className="btn-text greenwood-gate__enter-btn"
            onClick={onEnter}
            disabled={enterDisabled}
            aria-busy={enterPending || undefined}
          >
            [ ENTER THE GREENWOOD ]
          </button>
        </p>

        {enterPending ? (
          <p className="muted" role="status">
            the wood is looking at you...
          </p>
        ) : null}

        <div className="greenwood-gate__explain">
          <p>The Greenwood is not bought.</p>
          <p>It is entered through contribution.</p>
          <p className="greenwood-gate__pause">
            Deeds. Thought. Work. Participation.
          </p>
          <p>The wood keeps its own account.</p>
        </div>

        <p className="greenwood-gate__footnote muted">
          your standing will be examined at the gate.
        </p>
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
        mark="GREENWOOD"
        accent="greenwood"
        subtitle={<p className="muted">the wood is counting.</p>}
      />
    </article>
  );
}

type StandingProps = {
  standing: GreenwoodStandingView;
};

function GreenwoodStandingBlock({ standing }: StandingProps) {
  return (
    <div className="greenwood-gate__standing" aria-live="polite">
      <p className="greenwood-gate__standing-label">YOUR STANDING</p>
      <p className="greenwood-gate__standing-line">
        {standing.lifetimeLeaf} / {standing.threshold} LIFETIME LEAF
      </p>
    </div>
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
        title="THE GREENWOOD"
        mark="GREENWOOD"
        accent="greenwood"
        subtitle={
          <>
            <p>the path continues without you.</p>
            <p>not yet.</p>
          </>
        }
      />
      <div className="greenwood-gate__body">
        <GreenwoodStandingBlock standing={standing} />
        <p className="greenwood-gate__standing-remain">
          {standing.remainingLeaf} LEAF REMAIN.
        </p>
        <p className="greenwood-gate__enter">
          <button
            type="button"
            className="btn-text greenwood-gate__enter-btn"
            disabled
            aria-disabled="true"
          >
            [ THE WOOD REMAINS CLOSED ]
          </button>
        </p>
        <p className="greenwood-gate__footnote muted">
          the wood keeps its own account.
        </p>
      </div>
    </article>
  );
}

type EligibleProps = {
  standing: GreenwoodStandingView;
  enterDisabled: boolean;
  entering: boolean;
  onEnter: () => void;
};

export function GreenwoodGateEligible({
  standing,
  enterDisabled,
  entering,
  onEnter,
}: EligibleProps) {
  return (
    <article
      className="place greenwood-gate"
      aria-live="polite"
    >
      <AsciiPageTitle
        title="THE GREENWOOD"
        mark="GREENWOOD"
        accent="greenwood"
        subtitle={
          <>
            <p>you brought enough leaf.</p>
            <p>the path continues.</p>
          </>
        }
      />
      <div className="greenwood-gate__body">
        <GreenwoodStandingBlock standing={standing} />
        <p className="greenwood-gate__standing-remain">
          THE WOOD HAS HEARD ENOUGH.
        </p>
        <p className="greenwood-gate__enter">
          <button
            type="button"
            className="btn-text greenwood-gate__enter-btn"
            onClick={onEnter}
            disabled={enterDisabled || entering}
            aria-busy={entering || undefined}
          >
            [ ENTER THE GREENWOOD ]
          </button>
        </p>
        {entering ? (
          <p className="muted" role="status">
            the gate is opening...
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
        title={newlyAdmitted ? "THE GATE OPENS." : "THE GREENWOOD KNOWS YOU."}
        mark="GREENWOOD"
        accent="greenwood"
        subtitle={
          <>
            <p>{outlawLabel}</p>
            {newlyAdmitted ? (
              <p>you entered the Greenwood.</p>
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

/** Temporary Stage 8.3 interior — Stage 8.4 replaces this. */
export function GreenwoodGateInterior({ outlawLabel }: { outlawLabel: string }) {
  return (
    <article
      className="place greenwood-gate greenwood-gate--admitted"
      aria-live="polite"
    >
      <AsciiPageTitle
        title="THE GREENWOOD"
        mark="GREENWOOD"
        accent="greenwood"
        subtitle={
          <>
            <p>{outlawLabel}</p>
            <p>you are inside.</p>
          </>
        }
      />
      <div className="greenwood-gate__body">
        <p>the deeper paths are still being cut.</p>
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
        mark="GREENWOOD"
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
      </div>
    </article>
  );
}

export function GreenwoodGateEnterError({
  onRetry,
  retryPending = false,
}: ErrorProps) {
  return (
    <article
      className="place greenwood-gate"
      aria-live="polite"
    >
      <AsciiPageTitle
        title="THE GATE DID NOT OPEN."
        mark="GREENWOOD"
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
      </div>
    </article>
  );
}
