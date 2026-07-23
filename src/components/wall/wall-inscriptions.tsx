"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import {
  fetchWallMarksStatus,
  postLeaveWallMark,
} from "@/lib/wall/client";
import { formatWallInscriptionTime } from "@/lib/wall/format";
import type { PublicWallEntry } from "@/lib/wall/types";

type Props = {
  entries: PublicWallEntry[];
};

type MarkUiState = "idle" | "leaving" | "left" | "error";

/**
 * Chronological Wall inscriptions — newest first.
 * Marks are acknowledgement only. No composer. No reply box.
 *
 * Remount via key when the SSR entry list identity changes.
 */
export function WallInscriptions({ entries }: Props) {
  const {
    privyReady,
    authenticated,
    registered,
    profileResolved,
    login,
    getAuthHeaders,
  } = useFennAuth();

  const [countOverrides, setCountOverrides] = useState<Record<string, number>>(
    {},
  );
  const [states, setStates] = useState<Record<string, MarkUiState>>({});

  useEffect(() => {
    if (
      !privyReady ||
      !authenticated ||
      !registered ||
      !profileResolved ||
      entries.length === 0
    ) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const headers = await getAuthHeaders();
      if (!headers || cancelled) return;
      const result = await fetchWallMarksStatus(
        entries.map((e) => e.id),
        headers,
      );
      if (cancelled || !result.ok) return;

      setStates((prev) => {
        const next = { ...prev };
        for (const entry of entries) {
          if (result.marks[entry.id]) {
            next[entry.id] = "left";
          }
        }
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    privyReady,
    authenticated,
    registered,
    profileResolved,
    entries,
    getAuthHeaders,
  ]);

  if (entries.length === 0) {
    return (
      <div className="wall-empty">
        <p className="wall-empty__line">nothing has been left.</p>
        <p className="wall-empty__line muted">the wall is bare.</p>
      </div>
    );
  }

  async function onLeaveMark(entryId: string) {
    if (!privyReady) return;

    if (!authenticated) {
      login();
      return;
    }

    if (!registered) {
      return;
    }

    const current = states[entryId] ?? "idle";
    if (current === "leaving" || current === "left") return;

    setStates((prev) => ({ ...prev, [entryId]: "leaving" }));

    const headers = await getAuthHeaders();
    if (!headers) {
      setStates((prev) => ({ ...prev, [entryId]: "error" }));
      return;
    }

    const result = await postLeaveWallMark(entryId, headers);
    if (!result.ok) {
      setStates((prev) => ({ ...prev, [entryId]: "error" }));
      return;
    }

    setCountOverrides((prev) => ({
      ...prev,
      [entryId]: result.result.count,
    }));
    setStates((prev) => ({ ...prev, [entryId]: "left" }));
  }

  return (
    <div className="wall-sheet" aria-label="wall inscriptions">
      {entries.map((entry) => {
        const count = countOverrides[entry.id] ?? entry.markCount;
        const state = states[entry.id] ?? "idle";

        return (
          <article key={entry.id} id={entry.id} className="wall-entry">
            <header className="wall-entry__meta">
              <time dateTime={entry.createdAt}>
                {formatWallInscriptionTime(entry.createdAt)}
              </time>
            </header>
            <pre className="ascii wall-entry__body">{entry.body}</pre>
            <p className="wall-entry__mark">
              <WallMarkControl
                state={state}
                count={count}
                authenticated={authenticated}
                registered={registered}
                onLeave={() => void onLeaveMark(entry.id)}
              />
            </p>
            <hr className="wall-entry__rule" />
          </article>
        );
      })}
      <p className="wall-end muted" aria-hidden="true">
        end of wall.
      </p>
    </div>
  );
}

function WallMarkControl({
  state,
  count,
  authenticated,
  registered,
  onLeave,
}: {
  state: MarkUiState;
  count: number;
  authenticated: boolean;
  registered: boolean;
  onLeave: () => void;
}) {
  const countLabel = String(count);

  if (state === "left") {
    return (
      <span className="wall-mark wall-mark--left">
        <span className="wall-mark__action">MARK LEFT.</span>{" "}
        <span className="wall-mark__count">{countLabel}</span>
      </span>
    );
  }

  if (authenticated && !registered) {
    return (
      <span className="wall-mark">
        <Link href="/#outlaw-register" className="wall-mark__action btn-text">
          [ LEAVE A MARK ]
        </Link>{" "}
        <span className="wall-mark__count">{countLabel}</span>
      </span>
    );
  }

  if (state === "leaving") {
    return (
      <span className="wall-mark wall-mark--busy">
        <span className="wall-mark__action">[ LEAVING A MARK... ]</span>{" "}
        <span className="wall-mark__count">{countLabel}</span>
      </span>
    );
  }

  const label = state === "error" ? "[ TRY AGAIN ]" : "[ LEAVE A MARK ]";

  return (
    <span className="wall-mark">
      <button
        type="button"
        className="wall-mark__action btn-text"
        onClick={onLeave}
      >
        {label}
      </button>{" "}
      <span className="wall-mark__count">{countLabel}</span>
    </span>
  );
}
