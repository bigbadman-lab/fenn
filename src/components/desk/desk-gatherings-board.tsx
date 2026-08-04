"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DeskGatheringCallForm } from "@/components/desk/desk-gathering-call-form";
import { DeskGatheringOperate } from "@/components/desk/desk-gathering-operate";
import { useDeskGate } from "@/components/desk/desk-gate";
import type {
  DeskGatheringDetail,
  DeskGatheringListItem,
} from "@/lib/desk/gatherings-types";
import {
  gatheringAnnouncementStyleLabel,
} from "@/lib/greenwood/gatherings/announcement-style";
import {
  durationMinutesBetween,
  formatBeginsInLabel,
  formatDurationMinutesLabel,
  formatRemainingDurationLabel,
} from "@/lib/greenwood/gatherings/duration";

type BoardMode =
  | { kind: "list" }
  | { kind: "call"; draft?: DeskGatheringListItem | null }
  | { kind: "operate"; gatheringId: string };

function afterLabel(item: DeskGatheringListItem): string {
  if (item.resolvedState === "cancelled") return "Cancelled";
  if (item.status === "closed" || item.closedAt != null) return "Closed";
  return "Ended";
}

/**
 * Desk Gatherings board — call, operate, after the Fire.
 */
export function DeskGatheringsBoard() {
  const { getAuthHeaders } = useDeskGate();
  const [items, setItems] = useState<DeskGatheringListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<BoardMode>({ kind: "list" });
  const [activeDetail, setActiveDetail] = useState<DeskGatheringDetail | null>(
    null,
  );

  const loadList = useCallback(async () => {
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setItems([]);
      setError("Keeper access is required.");
      return;
    }
    const response = await fetch("/api/desk/gatherings?filter=all", {
      headers,
      cache: "no-store",
    });
    const data = (await response.json()) as {
      ok?: boolean;
      gatherings?: DeskGatheringListItem[];
      error?: string;
    };
    if (!response.ok || !data.ok) {
      setError(data.error ?? "The Gatherings could not be opened.");
      setItems([]);
      return;
    }
    setItems(data.gatherings ?? []);
  }, [getAuthHeaders]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadList();
    }, 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadList();
    }, 45_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [loadList]);

  const buckets = useMemo(() => {
    const list = items ?? [];
    const live = list.filter((g) => g.resolvedState === "active");
    const upcoming = list.filter((g) => g.resolvedState === "scheduled");
    const after = list.filter(
      (g) =>
        g.resolvedState === "closed" || g.resolvedState === "cancelled",
    );
    const drafts = list.filter(
      (g) => g.resolvedState === "draft" || g.status === "draft",
    );
    return { live, upcoming, after, drafts };
  }, [items]);

  async function openOperate(id: string) {
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) return;
    const response = await fetch(`/api/desk/gatherings/${id}`, {
      headers,
      cache: "no-store",
    });
    const data = (await response.json()) as {
      gathering?: DeskGatheringDetail;
      error?: string;
    };
    if (!response.ok || !data.gathering) {
      setError(data.error ?? "That Gathering could not be found.");
      return;
    }
    setActiveDetail(data.gathering);
    setMode({ kind: "operate", gatheringId: id });
  }

  if (mode.kind === "call") {
    return (
      <DeskGatheringCallForm
        getAuthHeaders={getAuthHeaders}
        draftSeed={mode.draft ?? null}
        onCancel={() => setMode({ kind: "list" })}
        onBegun={(gathering) => {
          setActiveDetail(gathering);
          setMode({ kind: "operate", gatheringId: gathering.id });
          void loadList();
        }}
      />
    );
  }

  if (mode.kind === "operate" && activeDetail) {
    return (
      <section className="desk-gatherings" aria-label="Operate Gathering">
        <p>
          <button
            type="button"
            className="btn-text"
            onClick={() => {
              setMode({ kind: "list" });
              setActiveDetail(null);
              void loadList();
            }}
          >
            [ back to Gatherings ]
          </button>
        </p>
        <DeskGatheringOperate
          gathering={activeDetail}
          getAuthHeaders={getAuthHeaders}
          onChanged={async () => {
            await loadList();
            await openOperate(activeDetail.id);
          }}
        />
      </section>
    );
  }

  return (
    <section className="desk-gatherings" aria-label="Gatherings">
      <div className="desk-overview__header">
        <h2 className="desk-section-title">GATHERINGS</h2>
        <button
          type="button"
          className="btn-text"
          onClick={() => void loadList()}
        >
          [ refresh ]
        </button>
      </div>
      <p className="muted">Call the Greenwood. Operate the Fire. Record what remains.</p>

      {error ? (
        <p className="desk-gathering-call__error" role="alert">
          {error}
        </p>
      ) : null}

      <p>
        <button
          type="button"
          className="btn-text desk-gathering-call__begin"
          onClick={() => setMode({ kind: "call" })}
        >
          [ Call a Gathering ]
        </button>
      </p>

      <p className="desk-divider" aria-hidden>
        ────────────────────
      </p>

      <h3 className="desk-overview__group-title">LIVE</h3>
      {items == null ? <p className="muted">…</p> : null}
      {items && buckets.live.length === 0 ? (
        <p className="muted">No Gathering is burning.</p>
      ) : null}
      {buckets.live.map((item) => (
        <GatheringRow
          key={item.id}
          item={item}
          section="live"
          onOperate={() => void openOperate(item.id)}
        />
      ))}

      <h3 className="desk-overview__group-title">UPCOMING</h3>
      {items && buckets.upcoming.length === 0 ? (
        <p className="muted">Nothing waits on the Fire.</p>
      ) : null}
      {buckets.upcoming.map((item) => (
        <GatheringRow
          key={item.id}
          item={item}
          section="upcoming"
          onOperate={() => void openOperate(item.id)}
        />
      ))}

      <h3 className="desk-overview__group-title">AFTER THE FIRE</h3>
      {items && buckets.after.length === 0 ? (
        <p className="muted">No closed or cancelled Gatherings yet.</p>
      ) : null}
      {buckets.after.map((item) => (
        <GatheringRow
          key={item.id}
          item={item}
          section="after"
          onOperate={() => void openOperate(item.id)}
        />
      ))}

      {buckets.drafts.length > 0 ? (
        <>
          <h3 className="desk-overview__group-title">UNFINISHED CALLS</h3>
          <p className="muted">
            Older drafts. Resume into Begin Gathering, or open for detail.
          </p>
          <ul className="desk-member__list">
            {buckets.drafts.map((item) => (
              <li key={item.id}>
                {item.title} ·{" "}
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => setMode({ kind: "call", draft: item })}
                >
                  [ resume ]
                </button>{" "}
                <Link
                  href={`/desk/gatherings/${item.id}`}
                  className="btn-text"
                >
                  [ detail ]
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function GatheringRow({
  item,
  section,
  onOperate,
}: {
  item: DeskGatheringListItem;
  section: "live" | "upcoming" | "after";
  onOperate: () => void;
}) {
  const now = Date.now();
  const remain = Math.max(0, Date.parse(item.endsAt) - now);
  const until = Math.max(0, Date.parse(item.startsAt) - now);
  const duration = durationMinutesBetween(item.startsAt, item.endsAt);
  const label =
    section === "live"
      ? "Operate"
      : section === "upcoming"
        ? "Inspect"
        : "Review";

  return (
    <div className="desk-gathering-row">
      <p className="desk-gathering-row__title">{item.title}</p>
      <p className="muted desk-gathering-row__meta">
        {section === "live" ? (
          <>
            {formatRemainingDurationLabel(remain)} remain · {item.handCount} hands
            · {item.attendanceCount} attendance
            {item.capacity != null ? ` · cap ${item.capacity}` : ""} ·{" "}
            {gatheringAnnouncementStyleLabel(item.announcementStyle)}
          </>
        ) : null}
        {section === "upcoming" ? (
          <>
            begins in {formatBeginsInLabel(until)}
            {duration != null
              ? ` · ${formatDurationMinutesLabel(duration)}`
              : ""}{" "}
            · {gatheringAnnouncementStyleLabel(item.announcementStyle)}
          </>
        ) : null}
        {section === "after" ? (
          <>
            {afterLabel(item)} · {item.handCount} hands · {item.attendanceCount}{" "}
            attendance
            {item.rewardCampaign ? " · campaign" : ""}
          </>
        ) : null}
      </p>
      <p className="desk-gathering-row__actions">
        <button type="button" className="btn-text" onClick={onOperate}>
          [ {label} ]
        </button>{" "}
        <Link href={`/desk/gatherings/${item.id}`} className="btn-text">
          [ detail ]
        </Link>
      </p>
    </div>
  );
}
