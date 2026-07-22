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

import type {
  SafeApplicationSummary,
  SafeProfile,
} from "@/lib/profiles/types";

type MeResponse = {
  authenticated: boolean;
  registered?: boolean;
  profile: SafeProfile | null;
  application: SafeApplicationSummary | null;
  wallets?: string[];
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
  /** True after /api/auth/me finished (success or handled error) for current session. */
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
  refreshMe: (opts?: { quiet?: boolean }) => Promise<void>;
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
  const fetchGeneration = useRef(0);

  const getAuthHeaders = useCallback(async (): Promise<HeadersInit | null> => {
    const accessToken = await waitForAccessToken();
    if (!accessToken) return null;
    return {
      Authorization: `Bearer ${accessToken}`,
    };
  }, []);

  const clearFennProfileState = useCallback(() => {
    setProfile(null);
    setApplication(null);
    setWallets([]);
    setRegistered(false);
    setProfileResolved(false);
    setError(null);
    setProfileLoading(false);
    setWalletWaitExhausted(false);
  }, []);

  const refreshMe = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!ready) return;

    if (!authenticated) {
      clearFennProfileState();
      return;
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
      if (generation !== fetchGeneration.current) return;

      if (!headers) {
        if (!quiet) {
          setProfile(null);
          setApplication(null);
          setWallets([]);
          setRegistered(false);
          setProfileResolved(true);
          setError("Could not obtain Privy access token");
        }
        return;
      }

      const response = await fetch("/api/auth/me", {
        method: "GET",
        headers,
        cache: "no-store",
      });

      if (generation !== fetchGeneration.current) return;

      const data = (await response.json()) as MeResponse;

      if (!response.ok) {
        if (!quiet) {
          setProfile(null);
          setApplication(null);
          setWallets([]);
          setRegistered(false);
          setProfileResolved(true);
          setError(data.error ?? "Failed to load FENN identity");
        }
        return;
      }

      setProfile(data.profile);
      setApplication(data.application);
      setWallets(data.wallets ?? []);
      setRegistered(Boolean(data.registered && data.profile));
      setProfileResolved(true);
      setError(null);
      if ((data.wallets ?? []).length > 0) {
        setWalletWaitExhausted(false);
      }
    } catch {
      if (generation !== fetchGeneration.current) return;
      if (!quiet) {
        setProfileResolved(true);
        setError("Failed to load FENN identity");
      }
    } finally {
      if (!quiet && generation === fetchGeneration.current) {
        setProfileLoading(false);
      }
    }
  }, [authenticated, clearFennProfileState, getAuthHeaders, ready]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      void refreshMe();
    }, 0);
    return () => window.clearTimeout(timer);
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
