"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { GreenwoodCrossing } from "@/components/greenwood/greenwood-crossing";
import {
  GreenwoodGate,
  GreenwoodGateHoldingMessage,
} from "@/components/greenwood/greenwood-gate";

type GatewayPhase = "crossing" | "gate" | "gate-message";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return reduced;
}

type GreenwoodGatewaySessionProps = {
  startCrossing: boolean;
};

/**
 * Stage 5 Greenwood gateway: crossing → public gate → truthful holding message.
 * No standing/admission checks. No greenwood_* reads or writes.
 */
function GreenwoodGatewaySession({
  startCrossing,
}: GreenwoodGatewaySessionProps) {
  const router = useRouter();
  const reducedMotion = usePrefersReducedMotion();
  const {
    privyReady,
    authenticated,
    registered,
    loading,
    walletResolving,
    login,
  } = useFennAuth();

  const [phase, setPhase] = useState<GatewayPhase>(
    startCrossing ? "crossing" : "gate",
  );

  const finishCrossing = useCallback(() => {
    setPhase("gate");
    if (startCrossing) {
      router.replace("/greenwood", { scroll: false });
    }
  }, [router, startCrossing]);

  const handleEnter = useCallback(() => {
    if (!privyReady || loading || walletResolving) {
      return;
    }

    if (!authenticated) {
      login();
      return;
    }

    if (!registered) {
      router.push("/#outlaw-register");
      return;
    }

    // Authenticated + registered: Stage 5 holding only — no admission.
    setPhase("gate-message");
  }, [
    authenticated,
    loading,
    login,
    privyReady,
    registered,
    router,
    walletResolving,
  ]);

  if (phase === "crossing") {
    return (
      <GreenwoodCrossing
        reducedMotion={reducedMotion}
        onComplete={finishCrossing}
      />
    );
  }

  if (phase === "gate-message") {
    return (
      <GreenwoodGateHoldingMessage onReturn={() => setPhase("gate")} />
    );
  }

  const enterPending =
    authenticated && (loading || walletResolving || !privyReady);

  return (
    <GreenwoodGate
      enterDisabled={!privyReady || enterPending}
      enterPending={enterPending}
      onEnter={handleEnter}
    />
  );
}

export function GreenwoodGateway() {
  const searchParams = useSearchParams();
  const startCrossing = searchParams.get("crossing") === "1";

  // Remount when crossing query appears so the transition restarts cleanly.
  return (
    <GreenwoodGatewaySession
      key={startCrossing ? "crossing" : "direct"}
      startCrossing={startCrossing}
    />
  );
}
