"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { GreenwoodArrivalCeremony } from "@/components/greenwood/greenwood-arrival-ceremony";
import { GreenwoodCrossing } from "@/components/greenwood/greenwood-crossing";
import {
  GreenwoodGate,
  GreenwoodGateEligible,
  GreenwoodGateEnterError,
  GreenwoodGateIneligible,
  GreenwoodGateListening,
  GreenwoodGateStatusError,
} from "@/components/greenwood/greenwood-gate";
import { GreenwoodMember } from "@/components/greenwood/greenwood-member";
import {
  fetchGreenwoodStatus,
  postGreenwoodArrivalCeremonyComplete,
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
  alias: string | null;
  getAuthHeaders: () => Promise<HeadersInit | null>;
  reducedMotion: boolean;
};

/**
 * Status/admission UI for a registered Outlaw.
 * Remount via key={profileId} when identity changes.
 */
function RegisteredGreenwoodGate({
  outlawLabel,
  alias,
  getAuthHeaders,
  reducedMotion,
}: RegisteredGreenwoodGateProps) {
  const [registeredGate, setRegisteredGate] =
    useState<RegisteredGateState>(INITIAL_REGISTERED);
  const [statusRetrying, setStatusRetrying] = useState(false);
  const [admitPending, setAdmitPending] = useState(false);

  const statusRequestId = useRef(0);
  const enterInFlight = useRef(false);
  /** Session latch after ceremony visuals finish — avoids replay before durable write settles. */
  const ceremonyFinishedThisSession = useRef(false);

  const loadStatus = useCallback(async (opts?: { quiet?: boolean }) => {
    const quiet = Boolean(opts?.quiet);
    const requestId = ++statusRequestId.current;
    if (!quiet) {
      setRegisteredGate((prev) =>
        prev.view === "loading"
          ? prev
          : {
              ...prev,
              view: "loading",
            },
      );
    }

    const headers = await getAuthHeaders();
    if (!headers) {
      if (requestId !== statusRequestId.current) return;
      setStatusRetrying(false);
      if (!quiet) {
        setRegisteredGate({
          view: "status_error",
          standing: null,
          member: null,
          newlyAdmitted: false,
        });
      }
      return;
    }

    const result = await fetchGreenwoodStatus(headers);
    if (requestId !== statusRequestId.current) return;

    setStatusRetrying(false);

    if (!result.ok) {
      if (!quiet) {
        setRegisteredGate({
          view: "status_error",
          standing: null,
          member: null,
          newlyAdmitted: false,
        });
      }
      return;
    }

    const mapped = viewFromGreenwoodStatus(result.status);
    setRegisteredGate((prev) => {
      // Quiet focus refresh must not eject an open member interior.
      if (quiet && prev.view === "interior" && mapped.view === "member") {
        return {
          ...prev,
          standing: mapped.standing ?? prev.standing,
          member: mapped.member ?? prev.member,
        };
      }

      // After ceremony visuals finish, stay in interior until durable state catches up.
      if (
        ceremonyFinishedThisSession.current &&
        mapped.view === "member" &&
        mapped.member
      ) {
        return {
          view: "interior",
          standing: mapped.standing ?? prev.standing,
          member: mapped.member,
          newlyAdmitted: true,
        };
      }

      const keepNewlyAdmitted =
        prev.newlyAdmitted &&
        (mapped.view === "member" ||
          (prev.view === "member" && mapped.view === "interior"));

      return {
        view: mapped.view,
        standing: mapped.standing ?? null,
        member: mapped.member ?? null,
        newlyAdmitted: keepNewlyAdmitted,
      };
    });
  }, [getAuthHeaders]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStatus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadStatus]);

  // World Pulse: quiet status refresh when the tab becomes visible again.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) return;
      void loadStatus({ quiet: true });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
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

      if (mapped.view === "interior") {
        void loadStatus({ quiet: true });
      }
    } finally {
      enterInFlight.current = false;
      setAdmitPending(false);
    }
  }, [getAuthHeaders, registeredGate.view, loadStatus]);

  const handleArrivalComplete = useCallback(async () => {
    ceremonyFinishedThisSession.current = true;
    setRegisteredGate((prev) => ({
      ...prev,
      view: "interior",
      newlyAdmitted: true,
    }));

    const headers = await getAuthHeaders();
    if (headers) {
      // Best-effort durable write; idempotent. Refresh may replay if this fails.
      await postGreenwoodArrivalCeremonyComplete(headers);
    }
    void loadStatus({ quiet: true });
  }, [getAuthHeaders, loadStatus]);

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
        <GreenwoodArrivalCeremony
          reducedMotion={reducedMotion}
          onComplete={() => {
            void handleArrivalComplete();
          }}
        />
      );
    case "interior":
      if (!registeredGate.member) {
        return <GreenwoodGateListening />;
      }
      return (
        <GreenwoodMember
          outlawLabel={outlawLabel}
          alias={alias}
          member={registeredGate.member}
          newlyAdmitted={registeredGate.newlyAdmitted}
          getAuthHeaders={getAuthHeaders}
        />
      );
    default:
      return <GreenwoodGateListening />;
  }
}

type GreenwoodGatewaySessionProps = {
  startCrossing: boolean;
};

/**
 * Greenwood gateway: optional road crossing → gate → admission →
 * one-time arrival ceremony → member interior.
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
        alias={profile.alias}
        getAuthHeaders={getAuthHeaders}
        reducedMotion={reducedMotion}
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
