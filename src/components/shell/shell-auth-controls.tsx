"use client";

import Link from "next/link";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { formatOutlawNumber } from "@/lib/profiles/types";

export function ShellAuthControls() {
  const {
    privyReady,
    loading,
    authenticated,
    registered,
    profile,
    walletResolving,
    error,
    login,
    logout,
  } = useFennAuth();

  if (!privyReady || loading || walletResolving) {
    return (
      <div className="shell-auth" aria-live="polite">
        <span className="muted">...</span>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="shell-auth">
        <button type="button" className="btn-text" onClick={() => login()}>
          [ connect ]
        </button>
      </div>
    );
  }

  if (error && !registered) {
    return (
      <div className="shell-auth">
        <span className="muted">[ session? ]</span>
        <button type="button" className="btn-text" onClick={() => void logout()}>
          [ leave ]
        </button>
      </div>
    );
  }

  if (!registered || !profile) {
    return (
      <div className="shell-auth">
        <Link href="/outlaw/register" className="btn-text">
          [ register ]
        </Link>
        <button type="button" className="btn-text" onClick={() => void logout()}>
          [ leave ]
        </button>
      </div>
    );
  }

  return (
    <div className="shell-auth">
      <Link href="/outlaw" className="btn-text">
        [ outlaw {formatOutlawNumber(profile.outlawNumber)} ]
      </Link>
      <button type="button" className="btn-text" onClick={() => void logout()}>
        [ leave ]
      </button>
    </div>
  );
}
