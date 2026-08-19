"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getAccessToken, usePrivy } from "@privy-io/react-auth";

import type { SafeFirstThirtyProgress } from "@/lib/first-thirty/types";
import type { OutlawInviteMemberSummary } from "@/lib/invites/types";
import type {
  SafeApplicationSummary,
  SafeProfile,
} from "@/lib/profiles/types";
import { WORLD_PULSE_PROFILE_FOCUS_MIN_MS } from "@/lib/world-pulse/intervals";

type BootstrapResponse = {
  ok?: boolean;
  authenticated?: boolean;
  registered?: boolean;
  profile: SafeProfile | null;
  application: SafeApplicationSummary | null;
  wallets?: string[];
  firstThirty?: SafeFirstThirtyProgress | null;
  inviteSummary?: OutlawInviteMemberSummary | null;
  errors?: {
    firstThirty?: boolean;
    inviteSummary?: boolean;
  };
  error?: string;
};

type FennAuthContextValue = {
  privyReady: boolean;
  /** Privy session — independent of FENN registration. */
  authenticated: boolean;
  /** Alias for Privy authenticated (compat). */
  privyAuthenticated: boolean;
  /** True while resolving FENN profile for an authenticated Privy session. */
  profileLoading: boolean;
  meLoading: boolean;
  /** True after bootstrap finished (success or handled error) for current session. */
  profileResolved: boolean;
  /**
   * Authenticated, unregistered, and still waiting for a verified EVM wallet
   * (e.g. Privy embedded wallet provisioning after email login).
   */
  walletResolving: boolean;
  registered: boolean;
  profile: SafeProfile | null;
  application: SafeApplicationSummary | null;
  wallets: string[];
  error: string | null;
  /** Privy not ready, or authenticated and FENN profile still resolving. */
  loading: boolean;
  /**
   * Changes when bootstrap identity state resets (logout / re-register).
   * Consumers should clear stale private snapshots when this changes.
   */
  bootstrapGeneration: number;
  /** Initial First Thirty from bootstrap (null when ineligible / unregistered). */
  firstThirtySnapshot: SafeFirstThirtyProgress | null;
  firstThirtyBootstrapFailed: boolean;
  /** Initial invite summary from bootstrap. */
  inviteSnapshot: OutlawInviteMemberSummary | null;
  inviteBootstrapFailed: boolean;
  /**
   * Refresh authenticated world snapshot (bootstrap).
   * quiet: update without full loading flash.
   * Resolves true when bootstrap applied successfully for this call.
   */
  refreshMe: (opts?: { quiet?: boolean }) => Promise<boolean>;
  login: () => void;
  logout: () => Promise<void>;
  getAuthHeaders: () => Promise<HeadersInit | null>;
};

const FennAuthContext = createContext<FennAuthContextValue | null>(null);

const WALLET_POLL_MS = 1500;
const WALLET_POLL_MAX_ATTEMPTS = 20;

async function waitForAccessToken(attempts = 10): Promise<string | null> {
  for (let i = 0; i < attempts; i += 1) {
    const token = await getAccessToken();
    if (token) return token;
    await new Promise((resolve) => {
      window.setTimeout(resolve, 50 * (i + 1));
    });
  }
  return null;
}

export function FennAuthProvider({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, login, logout } = usePrivy();
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileResolved, setProfileResolved] = useState(false);
  const [profile, setProfile] = useState<SafeProfile | null>(null);
  const [application, setApplication] = useState<SafeApplicationSummary | null>(
    null,
  );
  const [wallets, setWallets] = useState<string[]>([]);
  const [registered, setRegistered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [walletWaitExhausted, setWalletWaitExhausted] = useState(false);
  const [bootstrapGeneration, setBootstrapGeneration] = useState(0);
  const [firstThirtySnapshot, setFirstThirtySnapshot] =
    useState<SafeFirstThirtyProgress | null>(null);
  const [firstThirtyBootstrapFailed, setFirstThirtyBootstrapFailed] =
    useState(false);
  const [inviteSnapshot, setInviteSnapshot] =
    useState<OutlawInviteMemberSummary | null>(null);
  const [inviteBootstrapFailed, setInviteBootstrapFailed] = useState(false);
  const fetchGeneration = useRef(0);
  const profileIdRef = useRef<string | null>(null);
  const registeredRef = useRef(false);

  const getAuthHeaders = useCallback(async (): Promise<HeadersInit | null> => {
    const accessToken = await waitForAccessToken();
    if (!accessToken) return null;
    return {
      Authorization: `Bearer ${accessToken}`,
    };
  }, []);

  const clearMemberSnapshots = useCallback(() => {
    setFirstThirtySnapshot(null);
    setFirstThirtyBootstrapFailed(false);
    setInviteSnapshot(null);
    setInviteBootstrapFailed(false);
  }, []);

  const clearFennProfileState = useCallback(() => {
    profileIdRef.current = null;
    registeredRef.current = false;
    setProfile(null);
    setApplication(null);
    setWallets([]);
    setRegistered(false);
    setProfileResolved(false);
    setError(null);
    setProfileLoading(false);
    setWalletWaitExhausted(false);
    clearMemberSnapshots();
    setBootstrapGeneration((g) => g + 1);
  }, [clearMemberSnapshots]);

  const refreshMe = useCallback(
    async (opts?: { quiet?: boolean }): Promise<boolean> => {
      if (!ready) return false;

      if (!authenticated) {
        clearFennProfileState();
        return false;
      }

      const quiet = Boolean(opts?.quiet);
      const generation = ++fetchGeneration.current;
      if (!quiet) {
        setProfileLoading(true);
        setProfileResolved(false);
        setError(null);
      }

      try {
        const headers = await getAuthHeaders();
        if (generation !== fetchGeneration.current) return false;

        if (!headers) {
          if (!quiet) {
            profileIdRef.current = null;
            registeredRef.current = false;
            setProfile(null);
            setApplication(null);
            setWallets([]);
            setRegistered(false);
            clearMemberSnapshots();
            setProfileResolved(true);
            setError("Could not obtain Privy access token");
            setBootstrapGeneration((g) => g + 1);
          }
          return false;
        }

        const response = await fetch("/api/auth/bootstrap", {
          method: "GET",
          headers,
          cache: "no-store",
        });

        if (generation !== fetchGeneration.current) return false;

        const data = (await response.json()) as BootstrapResponse;

        if (!response.ok) {
          if (!quiet) {
            profileIdRef.current = null;
            registeredRef.current = false;
            setProfile(null);
            setApplication(null);
            setWallets([]);
            setRegistered(false);
            clearMemberSnapshots();
            setProfileResolved(true);
            setError(data.error ?? "Failed to load VELL identity");
            setBootstrapGeneration((g) => g + 1);
          }
          return false;
        }

        const nextRegistered = Boolean(data.registered && data.profile);
        const nextProfileId = data.profile?.id ?? null;
        const identityChanged =
          profileIdRef.current !== nextProfileId ||
          registeredRef.current !== nextRegistered;

        profileIdRef.current = nextProfileId;
        registeredRef.current = nextRegistered;

        setProfile(data.profile);
        setApplication(data.application);
        setWallets(data.wallets ?? []);
        setRegistered(nextRegistered);
        setFirstThirtySnapshot(data.firstThirty ?? null);
        setFirstThirtyBootstrapFailed(Boolean(data.errors?.firstThirty));
        setInviteSnapshot(data.inviteSummary ?? null);
        setInviteBootstrapFailed(Boolean(data.errors?.inviteSummary));
        setProfileResolved(true);
        setError(null);
        if ((data.wallets ?? []).length > 0) {
          setWalletWaitExhausted(false);
        }

        if (!quiet || identityChanged) {
          setBootstrapGeneration((g) => g + 1);
        }
        return true;
      } catch {
        if (generation !== fetchGeneration.current) return false;
        if (!quiet) {
          setProfileResolved(true);
          setError("Failed to load VELL identity");
          clearMemberSnapshots();
          setBootstrapGeneration((g) => g + 1);
        }
        return false;
      } finally {
        if (!quiet && generation === fetchGeneration.current) {
          setProfileLoading(false);
        }
      }
    },
    [authenticated, clearFennProfileState, clearMemberSnapshots, getAuthHeaders, ready],
  );

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      void refreshMe();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [ready, authenticated, refreshMe]);

  // World Pulse: quiet bootstrap refresh when returning to a visible tab.
  useEffect(() => {
    if (!ready || !authenticated) return;

    let lastFocusRefreshAt = 0;
    const onVisibility = () => {
      if (document.hidden) return;
      const now = Date.now();
      if (now - lastFocusRefreshAt < WORLD_PULSE_PROFILE_FOCUS_MIN_MS) return;
      lastFocusRefreshAt = now;
      void refreshMe({ quiet: true });
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [ready, authenticated, refreshMe]);

  // After email login, Privy may need a moment to attach the embedded EVM wallet.
  useEffect(() => {
    if (
      !ready ||
      !authenticated ||
      !profileResolved ||
      registered ||
      wallets.length > 0 ||
      error
    ) {
      return;
    }

    let attempts = 0;
    let cancelled = false;
    const timer = window.setInterval(() => {
      if (cancelled) return;
      attempts += 1;
      void refreshMe({ quiet: true });
      if (attempts >= WALLET_POLL_MAX_ATTEMPTS) {
        window.clearInterval(timer);
        if (!cancelled) {
          setWalletWaitExhausted(true);
        }
      }
    }, WALLET_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    ready,
    authenticated,
    profileResolved,
    registered,
    wallets.length,
    error,
    refreshMe,
  ]);

  const walletResolving =
    authenticated &&
    profileResolved &&
    !registered &&
    wallets.length === 0 &&
    !error &&
    !walletWaitExhausted;

  const value = useMemo<FennAuthContextValue>(
    () => ({
      privyReady: ready,
      authenticated,
      privyAuthenticated: authenticated,
      profileLoading,
      meLoading: profileLoading,
      profileResolved,
      walletResolving,
      registered,
      profile,
      application,
      wallets,
      error:
        walletWaitExhausted && wallets.length === 0 && !registered && !error
          ? "No verified EVM wallet is available yet"
          : error,
      loading: !ready || (authenticated && !profileResolved),
      bootstrapGeneration,
      firstThirtySnapshot,
      firstThirtyBootstrapFailed,
      inviteSnapshot,
      inviteBootstrapFailed,
      refreshMe,
      login: () => {
        if (authenticated) return;
        login();
      },
      logout: async () => {
        fetchGeneration.current += 1;
        await logout();
        clearFennProfileState();
      },
      getAuthHeaders,
    }),
    [
      ready,
      authenticated,
      profileLoading,
      profileResolved,
      walletResolving,
      walletWaitExhausted,
      registered,
      profile,
      application,
      wallets,
      error,
      bootstrapGeneration,
      firstThirtySnapshot,
      firstThirtyBootstrapFailed,
      inviteSnapshot,
      inviteBootstrapFailed,
      refreshMe,
      login,
      logout,
      clearFennProfileState,
      getAuthHeaders,
    ],
  );

  return (
    <FennAuthContext.Provider value={value}>{children}</FennAuthContext.Provider>
  );
}

export function useFennAuth() {
  const ctx = useContext(FennAuthContext);
  if (!ctx) {
    throw new Error("useFennAuth must be used within FennAuthProvider");
  }
  return ctx;
}
