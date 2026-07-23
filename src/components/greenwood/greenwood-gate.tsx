"use client";

import { GREENWOOD_GATE_ASCII } from "@/components/greenwood/greenwood-frames";
import { AsciiPageTitle } from "@/components/ui/ascii-page-title";

type GreenwoodGateProps = {
  enterDisabled: boolean;
  enterPending: boolean;
  onEnter: () => void;
};

export function GreenwoodGate({
  enterDisabled,
  enterPending,
  onEnter,
}: GreenwoodGateProps) {
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

type GreenwoodGateMessageProps = {
  onReturn: () => void;
};

/** Stage 5 temporary holding message — not admission refusal/success. */
export function GreenwoodGateHoldingMessage({
  onReturn,
}: GreenwoodGateMessageProps) {
  return (
    <article
      className="place greenwood-gate greenwood-gate--holding"
      aria-live="polite"
    >
      <AsciiPageTitle
        title="THE GATE IS NOT YET LISTENING."
        mark="GREENWOOD"
        accent="greenwood"
        subtitle={
          <>
            <p>the wood knows who you are.</p>
            <p>the crossing has not begun.</p>
          </>
        }
      />
      <div className="greenwood-gate__body">
        <p className="greenwood-gate__enter">
          <button type="button" className="btn-text" onClick={onReturn}>
            [ return ]
          </button>
        </p>
      </div>
    </article>
  );
}
