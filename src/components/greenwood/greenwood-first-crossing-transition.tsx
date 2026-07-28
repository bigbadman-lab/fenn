"use client";

import { useEffect, useState } from "react";

import { AsciiPageTitle } from "@/components/ui/ascii-page-title";

type GreenwoodFirstCrossingTransitionProps = {
  reducedMotion: boolean;
  onComplete: () => void;
};

type Step = 0 | 1 | 2;

export function GreenwoodFirstCrossingTransition({
  reducedMotion,
  onComplete,
}: GreenwoodFirstCrossingTransitionProps) {
  const [step, setStep] = useState<Step>(reducedMotion ? 2 : 0);

  useEffect(() => {
    if (reducedMotion) {
      const t = window.setTimeout(() => {
        onComplete();
      }, 0);
      return () => window.clearTimeout(t);
    }

    // Total ~3.7s: short pause, short pause, inside hold.
    const t1 = window.setTimeout(() => setStep(1), 850);
    const t2 = window.setTimeout(() => setStep(2), 1750);
    const t3 = window.setTimeout(() => onComplete(), 3750);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [onComplete, reducedMotion]);

  const content =
    step === 0 ? (
      <>
        <p>you leave the road.</p>
        <p className="muted">...</p>
      </>
    ) : step === 1 ? (
      <>
        <p>the trees close behind you.</p>
        <p className="muted">...</p>
      </>
    ) : (
      <>
        <p>you are inside.</p>
        <p className="muted">THE GREENWOOD takes its time.</p>
        <pre aria-hidden="true" className="ascii greenwood-interior__transition-ascii">
          {`      |||
  &&&&  |||  &&&&
       \\|||/
        \\|/
         v`}
        </pre>
      </>
    );

  return (
    <article className="place greenwood-gate greenwood-gate--admitted">
      <AsciiPageTitle
        title="THE GREENWOOD"
        mark="GREENWOOD"
        accent="greenwood"
        subtitle={
          <p className="muted">finding the inside...</p>
        }
      />
      <div role="status" aria-live="polite" aria-busy="true">
        <div className="greenwood-transition__body">{content}</div>
      </div>
    </article>
  );
}

