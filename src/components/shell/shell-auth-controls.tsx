"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
} from "react";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { formatOutlawNumber } from "@/lib/profiles/types";

function LeaveConfirmDialog({
  open,
  busy,
  onStay,
  onLeave,
}: {
  open: boolean;
  busy: boolean;
  onStay: () => void;
  onLeave: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const stayRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open) {
      if (!el.open) el.showModal();
      // Prefer stay as the default focused action.
      window.setTimeout(() => stayRef.current?.focus(), 0);
    } else if (el.open) {
      el.close();
    }
  }, [open]);

  function onBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current && !busy) {
      onStay();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="shell-leave-dialog"
      aria-labelledby={titleId}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onStay();
      }}
      onClick={onBackdropClick}
    >
      <div className="shell-leave-dialog__panel">
        <p id={titleId} className="shell-leave-dialog__title">
          LEAVE THE ROAD?
        </p>
        <p className="shell-leave-dialog__body">
          This session ends here.
          <br />
          The wood keeps no seat warm.
        </p>
        <p className="muted shell-leave-dialog__hint">
          Return when the road calls again.
        </p>
        <div className="shell-leave-dialog__actions">
          <button
            ref={stayRef}
            type="button"
            className="btn-text"
            disabled={busy}
            onClick={onStay}
          >
            [ stay ]
          </button>
          <button
            type="button"
            className="btn-text"
            disabled={busy}
            onClick={onLeave}
          >
            {busy ? "[ leaving… ]" : "[ leave ]"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

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
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const requestLeave = useCallback(() => {
    setLeaveOpen(true);
  }, []);

  const stay = useCallback(() => {
    if (leaving) return;
    setLeaveOpen(false);
  }, [leaving]);

  const confirmLeave = useCallback(async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      await logout();
    } finally {
      setLeaving(false);
      setLeaveOpen(false);
    }
  }, [leaving, logout]);

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
          [ enter ]
        </button>
      </div>
    );
  }

  const leaveDialog = (
    <LeaveConfirmDialog
      open={leaveOpen}
      busy={leaving}
      onStay={stay}
      onLeave={() => void confirmLeave()}
    />
  );

  if (error && !registered) {
    return (
      <div className="shell-auth">
        <span className="muted">[ session? ]</span>
        <button type="button" className="btn-text" onClick={requestLeave}>
          [ leave ]
        </button>
        {leaveDialog}
      </div>
    );
  }

  if (!registered || !profile) {
    return (
      <div className="shell-auth">
        <Link href="/#outlaw-register" className="btn-text">
          [ register ]
        </Link>
        <button type="button" className="btn-text" onClick={requestLeave}>
          [ leave ]
        </button>
        {leaveDialog}
      </div>
    );
  }

  return (
    <div className="shell-auth">
      <Link href="/outlaw" className="btn-text">
        [ outlaw {formatOutlawNumber(profile.outlawNumber)} ]
      </Link>
      <button type="button" className="btn-text" onClick={requestLeave}>
        [ leave ]
      </button>
      {leaveDialog}
    </div>
  );
}
