"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { GreenwoodCrossing } from "@/components/greenwood/greenwood-crossing";
import {
  GreenwoodGate,
  GreenwoodGateEligible,
  GreenwoodGateEnterError,
  GreenwoodGateIneligible,
  GreenwoodGateInterior,
  GreenwoodGateListening,
  GreenwoodGateMember,
  GreenwoodGateStatusError,
} from "@/components/greenwood/greenwood-gate";
import {
  fetchGreenwoodStatus,
  postGreenwoodEnter,
} from "@/lib/greenwood/client";
import {
  canSubmitGreenwoodEnter,
  resolveAuthGateBranch,
  viewFromAdmissionResult,
  viewFromGreenwoodStatus,
  type GreenwoodGateView,
  type GreenwoodMemberSnapshotView,
  type GreenwoodStandingView,
} from "@/lib/greenwood/gate-view";
import { formatOutlawNumber } from "@/lib/profiles/types";

type GatewayPhase = "crossing" | "gate";

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

type RegisteredGateState = {
  view: GreenwoodGateView;
  standing: GreenwoodStandingView | null;
  member: GreenwoodMemberSnapshotView | null;
  newlyAdmitted: boolean;
};

const INITIAL_REGISTERED: RegisteredGateState = {
  view: "loading",
  standing: null,
  member: null,
  newlyAdmitted: false,
};

type RegisteredGreenwoodGateProps = {
  outlawLabel: string;
  getAuthHeaders: () => Promise<HeadersInit | null>;
};

/**
 * Status/admission UI for a registered Outlaw.
 * Remount via key={profileId} when identity changes.
 */
function RegisteredGreenwoodGate({
  outlawLabel,
  getAuthHeaders,
}: RegisteredGreenwoodGateProps) {
  const [registeredGate, setRegisteredGate] =
    useState<RegisteredGateState>(INITIAL_REGISTERED);
  const [statusRetrying, setStatusRetrying] = useState(false);
  const [admitPending, setAdmitPending] = useState(false);

  const statusRequestId = useRef(0);
  const enterInFlight = useRef(false);

  const loadStatus = useCallback(async () => {
    const requestId = ++statusRequestId.current;
    setRegisteredGate((prev) =>
      prev.view === "loading"
        ? prev
        : {
            ...prev,
            view: "loading",
          },
    );

    const headers = await getAuthHeaders();
    if (!headers) {
      if (requestId !== statusRequestId.current) return;
      setStatusRetrying(false);
      setRegisteredGate({
        view: "status_error",
        standing: null,
        member: null,
        newlyAdmitted: false,
      });
      return;
    }

    const result = await fetchGreenwoodStatus(headers);
    if (requestId !== statusRequestId.current) return;

    setStatusRetrying(false);

    if (!result.ok) {
      setRegisteredGate({
        view: "status_error",
        standing: null,
        member: null,
        newlyAdmitted: false,
      });
      return;
    }

    const mapped = viewFromGreenwoodStatus(result.status);
    setRegisteredGate({
      view: mapped.view,
      standing: mapped.standing ?? null,
      member: mapped.member ?? null,
      newlyAdmitted: false,
    });
  }, [getAuthHeaders]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStatus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadStatus]);

  const handleAdmit = useCallback(async () => {
    if (enterInFlight.current) return;
    if (!canSubmitGreenwoodEnter(registeredGate.view)) return;

    enterInFlight.current = true;
    setAdmitPending(true);

    if (registeredGate.view === "eligible") {
      setRegisteredGate((prev) => ({
        ...prev,
        view: "entering",
      }));
    }

    try {
      const headers = await getAuthHeaders();
      if (!headers) {
        setRegisteredGate((prev) => ({
          ...prev,
          view: "enter_error",
        }));
        return;
      }

      const result = await postGreenwoodEnter(headers);
      if (!result.ok) {
        setRegisteredGate((prev) => ({
          ...prev,
          view: "enter_error",
        }));
        return;
      }

      const mapped = viewFromAdmissionResult(result.result);
      setRegisteredGate({
        view: mapped.view,
        standing: mapped.standing ?? null,
        member: mapped.member ?? null,
        newlyAdmitted: result.result.status === "admitted",
      });
    } finally {
      enterInFlight.current = false;
      setAdmitPending(false);
    }
  }, [getAuthHeaders, registeredGate.view]);

  const handleContinue = useCallback(() => {
    setRegisteredGate((prev) => ({
      ...prev,
      view: "interior",
    }));
  }, []);

  switch (registeredGate.view) {
    case "loading":
      return <GreenwoodGateListening />;
    case "status_error":
      return (
        <GreenwoodGateStatusError
          onRetry={() => {
            setStatusRetrying(true);
            void loadStatus();
          }}
          retryPending={statusRetrying}
        />
      );
    case "ineligible":
      if (!registeredGate.standing) {
        return <GreenwoodGateListening />;
      }
      return <GreenwoodGateIneligible standing={registeredGate.standing} />;
    case "eligible":
    case "entering":
      if (!registeredGate.standing) {
        return <GreenwoodGateListening />;
      }
      return (
        <GreenwoodGateEligible
          standing={registeredGate.standing}
          enterDisabled={registeredGate.view === "entering" || admitPending}
          entering={registeredGate.view === "entering" || admitPending}
          onEnter={() => {
            void handleAdmit();
          }}
        />
      );
    case "enter_error":
      return (
        <GreenwoodGateEnterError
          onRetry={() => {
            void handleAdmit();
          }}
          retryPending={admitPending}
        />
      );
    case "member":
      if (!registeredGate.member) {
        return <GreenwoodGateListening />;
      }
      return (
        <GreenwoodGateMember
          outlawLabel={outlawLabel}
          member={registeredGate.member}
          newlyAdmitted={registeredGate.newlyAdmitted}
          onContinue={handleContinue}
        />
      );
    case "interior":
      return <GreenwoodGateInterior outlawLabel={outlawLabel} />;
    default:
      return <GreenwoodGateListening />;
  }
}

type GreenwoodGatewaySessionProps = {
  startCrossing: boolean;
};

/**
 * Stage 8.3 Greenwood gateway: crossing → public gate → truthful status/admission.
 * Crossing is unchanged. Eligibility comes only from Stage 8.2 APIs.
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
    profile,
    loading,
    walletResolving,
    profileResolved,
    login,
    getAuthHeaders,
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

  const handlePublicEnter = useCallback(() => {
    if (!privyReady || loading || walletResolving) {
      return;
    }

    const branch = resolveAuthGateBranch({ authenticated, registered });
    if (branch === "login") {
      login();
      return;
    }
    if (branch === "register") {
      router.push("/#outlaw-register");
    }
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

  const authSettling =
    !privyReady || loading || walletResolving || !profileResolved;
  const branch = resolveAuthGateBranch({ authenticated, registered });

  if (authenticated && registered && !authSettling && profile) {
    return (
      <RegisteredGreenwoodGate
        key={profile.id}
        outlawLabel={`OUTLAW ${formatOutlawNumber(profile.outlawNumber)}`}
        getAuthHeaders={getAuthHeaders}
      />
    );
  }

  const enterPending =
    authenticated && (loading || walletResolving || !privyReady);
  const publicDisabled =
    !privyReady ||
    enterPending ||
    (authenticated && registered && authSettling);

  return (
    <GreenwoodGate
      enterDisabled={publicDisabled}
      enterPending={enterPending || (branch === "status" && authSettling)}
      onEnter={handlePublicEnter}
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
