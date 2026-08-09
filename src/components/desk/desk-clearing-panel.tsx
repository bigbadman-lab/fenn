"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { useDeskGate } from "@/components/desk/desk-gate";
import type {
  ClearingDeskHealth,
  ClearingDeskMessage,
  ClearingDeskMessageFilter,
  ClearingDeskSnapshot,
  ClearingSlowModeSeconds,
} from "@/lib/clearing/desk-types";
import {
  CLEARING_MUTE_PRESETS_SECONDS,
  CLEARING_SLOW_MODE_PRESETS,
} from "@/lib/clearing/desk-types";
import { CLEARING_DESK_POLL_MS } from "@/lib/clearing/config";
import { CLEARING_PUBLIC_SURFACE_ENABLED } from "@/lib/clearing/visibility";

const POLL_MS = CLEARING_DESK_POLL_MS;

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function muteLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${seconds / 60}m`;
  if (seconds < 86400) return `${seconds / 3600}h`;
  return `${seconds / 86400}d`;
}

function actionLabel(action: string): string {
  return action.replace(/_/g, " ");
}

export function DeskClearingPanel() {
  const { getAuthHeaders } = useDeskGate();
  const [snapshot, setSnapshot] = useState<ClearingDeskSnapshot | null>(null);
  const [health, setHealth] = useState<ClearingDeskHealth | null>(null);
  const [filter, setFilter] = useState<ClearingDeskMessageFilter>("all");
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [slowPick, setSlowPick] = useState<ClearingSlowModeSeconds>(0);
  const inFlight = useRef(false);

  const load = useCallback(
    async (opts?: { quiet?: boolean; cursor?: string | null; append?: boolean }) => {
      if (inFlight.current && !opts?.append) return;
      if (!opts?.append) inFlight.current = true;
      if (!opts?.quiet && !opts?.append) setError(null);
      const headers = await getAuthHeaders();
      if (!headers) {
        setError("Desk session is not ready.");
        setLoading(false);
        inFlight.current = false;
        return;
      }
      try {
        const params = new URLSearchParams({ filter });
        if (opts?.cursor) params.set("cursor", opts.cursor);
        const response = await fetch(`/api/desk/clearing?${params}`, {
          headers,
          cache: "no-store",
        });
        const data = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          clearing?: ClearingDeskSnapshot;
          health?: ClearingDeskHealth;
          error?: string;
        };
        if (!response.ok || !data.ok || !data.clearing) {
          setError(data.error ?? "The Clearing could not be read.");
          setLoading(false);
          return;
        }
        if (opts?.append) {
          setSnapshot((prev) => {
            if (!prev) return data.clearing ?? null;
            const seen = new Set(prev.messages.map((m) => m.id));
            const extra = (data.clearing?.messages ?? []).filter(
              (m) => !seen.has(m.id),
            );
            return {
              ...data.clearing!,
              messages: [...prev.messages, ...extra],
              nextCursor: data.clearing?.nextCursor ?? null,
            };
          });
        } else {
          setSnapshot(data.clearing);
          setSlowPick(
            (CLEARING_SLOW_MODE_PRESETS as readonly number[]).includes(
              data.clearing.state.slowModeSeconds,
            )
              ? (data.clearing.state.slowModeSeconds as ClearingSlowModeSeconds)
              : 0,
          );
        }
        if (data.health) setHealth(data.health);
        setLoading(false);
      } catch {
        setError("The Clearing could not be read.");
        setLoading(false);
      } finally {
        inFlight.current = false;
      }
    },
    [filter, getAuthHeaders],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load({ quiet: true });
    }, POLL_MS);
    return () => window.clearInterval(interval);
  }, [load]);

  const runAction = useCallback(
    async (key: string, body: Record<string, unknown>) => {
      if (busyKey) return;
      setBusyKey(key);
      setStatus(null);
      setError(null);
      try {
        const headers = await getAuthHeaders();
        if (!headers) {
          setError("Desk session is not ready.");
          return;
        }
        const response = await fetch("/api/clearing/moderation", {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...body,
            reason: reason.trim() || undefined,
          }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          message?: string;
        };
        if (!response.ok || !data.ok) {
          setError(data.error ?? "Action failed.");
          return;
        }
        setStatus(data.message ?? "Done.");
        await load({ quiet: true });
      } catch {
        setError("Action failed.");
      } finally {
        setBusyKey(null);
      }
    },
    [busyKey, getAuthHeaders, load, reason],
  );

  function onSlowSubmit(event: FormEvent) {
    event.preventDefault();
    void runAction("slow", {
      action: "set_state",
      slowModeSeconds: slowPick,
    });
  }

  const summary = snapshot?.summary;
  const messages = snapshot?.messages ?? [];
  const log = snapshot?.log ?? [];

  return (
    <section className="desk-clearing" aria-label="The Clearing">
      <div className="desk-overview__header">
        <h2 className="desk-section-title">THE CLEARING</h2>
        <button
          type="button"
          className="btn-text"
          onClick={() => void load()}
          disabled={Boolean(busyKey)}
        >
          [ refresh ]
        </button>
      </div>
      <p className="muted">Keeper control of the public road.</p>
      <p className="muted">
        <Link href="/desk" className="btn-text">
          [ desk overview ]
        </Link>
        {CLEARING_PUBLIC_SURFACE_ENABLED ? (
          <Link href="/camp/clearing" className="btn-text">
            [ open public clearing ]
          </Link>
        ) : null}
      </p>

      <p className="desk-divider" aria-hidden>
        ────────────────────
      </p>

      {loading && !snapshot ? <p className="muted">…</p> : null}
      {error ? (
        <p className="desk-clearing__feedback" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="desk-clearing__feedback" aria-live="polite">
          {status}
        </p>
      ) : null}

      {summary ? (
        <div className="desk-clearing__summary" aria-label="Clearing state">
          <p>
            Mode:{" "}
            <strong>
              {summary.mode === "read_only" ? "READ-ONLY" : "OPEN"}
            </strong>
          </p>
          <p>
            Slow mode:{" "}
            {summary.slowModeSeconds === 0
              ? "off"
              : `${summary.slowModeSeconds}s`}
          </p>
          <p className="muted">
            Published {summary.publishedCount} · Hidden {summary.hiddenCount}
          </p>
          <p className="muted">
            Muted travellers {summary.mutedTravellerCount} · Banned travellers{" "}
            {summary.bannedTravellerCount}
          </p>
          <p className="muted">
            Muted outlaws {summary.mutedOutlawCount} · Banned outlaws{" "}
            {summary.bannedOutlawCount}
            <span className="desk-clearing__scope"> · CLEARING VOICE ONLY</span>
          </p>
          {summary.lastActionLabel ? (
            <p className="muted">
              Last: {summary.lastActionLabel}
              {summary.lastActionAt
                ? ` · ${formatWhen(summary.lastActionAt)}`
                : ""}
            </p>
          ) : null}
          {health ? (
            <p className="muted desk-clearing__health" aria-label="Clearing health">
              Health: db {health.databaseReachable ? "ok" : "fail"} · state{" "}
              {health.stateReadable ? "ok" : "fail"} · rate RPC{" "}
              {health.rateLimitRpcAvailable ? "ok" : "fail"} · cookie config{" "}
              {health.cookieSecretConfigured ? "ok" : "missing"}
            </p>
          ) : null}
        </div>
      ) : null}

      <section
        className="desk-clearing__controls"
        aria-labelledby="clearing-global-title"
      >
        <h3 id="clearing-global-title" className="desk-clearing__h">
          GLOBAL
        </h3>
        <div className="desk-clearing__actions">
          {snapshot?.state.readOnly ? (
            <button
              type="button"
              className="btn-text"
              disabled={Boolean(busyKey)}
              onClick={() =>
                void runAction("open", {
                  action: "set_state",
                  readOnly: false,
                })
              }
            >
              {busyKey === "open" ? "[ … ]" : "[ REOPEN THE CLEARING ]"}
            </button>
          ) : (
            <button
              type="button"
              className="btn-text"
              disabled={Boolean(busyKey)}
              onClick={() =>
                void runAction("close", {
                  action: "set_state",
                  readOnly: true,
                })
              }
            >
              {busyKey === "close"
                ? "[ … ]"
                : "[ CLOSE THE CLEARING TO NEW VOICES ]"}
            </button>
          )}
        </div>
        <form className="desk-clearing__slow" onSubmit={onSlowSubmit}>
          <label htmlFor="clearing-slow">Slow mode</label>
          <select
            id="clearing-slow"
            value={slowPick}
            onChange={(e) =>
              setSlowPick(Number(e.target.value) as ClearingSlowModeSeconds)
            }
            disabled={Boolean(busyKey)}
          >
            {CLEARING_SLOW_MODE_PRESETS.map((s) => (
              <option key={s} value={s}>
                {s === 0 ? "off (0s)" : `${s}s`}
              </option>
            ))}
          </select>
          <button type="submit" className="btn-text" disabled={Boolean(busyKey)}>
            {busyKey === "slow" ? "[ … ]" : "[ SET SLOW MODE ]"}
          </button>
        </form>
      </section>

      <label className="desk-clearing__reason-lab" htmlFor="clearing-reason">
        Optional reason (Desk only)
      </label>
      <input
        id="clearing-reason"
        className="desk-clearing__reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        placeholder="short plain reason"
        disabled={Boolean(busyKey)}
      />

      <section aria-labelledby="clearing-messages-title">
        <h3 id="clearing-messages-title" className="desk-clearing__h">
          MESSAGES
        </h3>
        <div className="desk-clearing__filters">
          <label htmlFor="clearing-filter">Filter</label>
          <select
            id="clearing-filter"
            value={filter}
            onChange={(e) =>
              setFilter(e.target.value as ClearingDeskMessageFilter)
            }
          >
            <option value="all">all</option>
            <option value="visible">visible</option>
            <option value="hidden">hidden</option>
            <option value="traveller">travellers</option>
            <option value="outlaw">outlaws</option>
            <option value="voice_blocked">muted / banned authors</option>
          </select>
        </div>

        {messages.length === 0 && !loading ? (
          <p className="muted">No messages in this filter.</p>
        ) : null}

        <ul className="desk-clearing__list">
          {messages.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              busyKey={busyKey}
              onAction={runAction}
            />
          ))}
        </ul>
        {snapshot?.nextCursor ? (
          <p>
            <button
              type="button"
              className="btn-text"
              disabled={loadingOlder || Boolean(busyKey)}
              onClick={() => {
                setLoadingOlder(true);
                void load({
                  quiet: true,
                  append: true,
                  cursor: snapshot.nextCursor,
                }).finally(() => setLoadingOlder(false));
              }}
            >
              {loadingOlder ? "[ … ]" : "[ LOAD OLDER ]"}
            </button>
          </p>
        ) : null}
      </section>

      <section aria-labelledby="clearing-log-title">
        <h3 id="clearing-log-title" className="desk-clearing__h">
          MODERATION HISTORY
        </h3>
        {log.length === 0 ? (
          <p className="muted">No logged actions yet.</p>
        ) : (
          <ul className="desk-clearing__log">
            {log.map((item) => (
              <li key={item.id}>
                <span className="desk-clearing__log-action">
                  {actionLabel(item.action)}
                </span>
                {item.targetLabel ? (
                  <span> · {item.targetLabel}</span>
                ) : null}
                <span className="muted">
                  {" "}
                  · {item.actorLabel} · {formatWhen(item.createdAt)}
                </span>
                {item.reason ? (
                  <div className="muted desk-clearing__log-reason">
                    {item.reason}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function MessageRow({
  message: m,
  busyKey,
  onAction,
}: {
  message: ClearingDeskMessage;
  busyKey: string | null;
  onAction: (key: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const voiceBits: string[] = [];
  if (m.voice?.banned) voiceBits.push("banned");
  if (m.voice?.muted) voiceBits.push("muted");
  if (m.voice?.publishedCount != null && m.authorType === "traveller") {
    voiceBits.push(`${m.voice.publishedCount} published`);
  }

  return (
    <li className="desk-clearing__row">
      <header className="desk-clearing__row-head">
        <span className="desk-clearing__author">{m.authorLabel}</span>
        <span className="muted"> · {m.authorType}</span>
        <span className="muted"> · {m.status}</span>
        <span className="muted"> · {formatWhen(m.createdAt)}</span>
      </header>
      <p className="desk-clearing__body">{m.body}</p>
      {voiceBits.length > 0 ? (
        <p className="muted desk-clearing__voice">
          Voice: {voiceBits.join(" · ")}
          {m.authorType !== "traveller" ? (
            <span> · CLEARING VOICE ONLY</span>
          ) : null}
        </p>
      ) : null}
      {m.moderationReason ? (
        <p className="muted">Hide reason: {m.moderationReason}</p>
      ) : null}

      <div className="desk-clearing__row-actions">
        {m.status === "published" ? (
          <button
            type="button"
            className="btn-text"
            disabled={Boolean(busyKey)}
            onClick={() =>
              void onAction(`hide:${m.id}`, {
                action: "hide",
                messageId: m.id,
              })
            }
          >
            {busyKey === `hide:${m.id}` ? "[ … ]" : "[ HIDE ]"}
          </button>
        ) : null}
        {m.status === "hidden" ? (
          <button
            type="button"
            className="btn-text"
            disabled={Boolean(busyKey)}
            onClick={() =>
              void onAction(`restore:${m.id}`, {
                action: "unhide",
                messageId: m.id,
              })
            }
          >
            {busyKey === `restore:${m.id}` ? "[ … ]" : "[ RESTORE ]"}
          </button>
        ) : null}

        {m.travellerId ? (
          <>
            {CLEARING_MUTE_PRESETS_SECONDS.map((sec) => (
              <button
                key={sec}
                type="button"
                className="btn-text"
                disabled={Boolean(busyKey)}
                onClick={() =>
                  void onAction(`mute-t:${m.id}:${sec}`, {
                    action: "mute_traveller",
                    travellerId: m.travellerId,
                    muteSeconds: sec,
                  })
                }
              >
                {busyKey === `mute-t:${m.id}:${sec}`
                  ? "[ … ]"
                  : `[ MUTE ${muteLabel(sec).toUpperCase()} ]`}
              </button>
            ))}
            <button
              type="button"
              className="btn-text"
              disabled={Boolean(busyKey)}
              onClick={() =>
                void onAction(`unmute-t:${m.id}`, {
                  action: "unmute_traveller",
                  travellerId: m.travellerId,
                })
              }
            >
              {busyKey === `unmute-t:${m.id}` ? "[ … ]" : "[ UNMUTE ]"}
            </button>
            <button
              type="button"
              className="btn-text"
              disabled={Boolean(busyKey)}
              onClick={() =>
                void onAction(`ban-t:${m.id}`, {
                  action: "ban_traveller",
                  travellerId: m.travellerId,
                })
              }
            >
              {busyKey === `ban-t:${m.id}` ? "[ … ]" : "[ BAN ]"}
            </button>
            <button
              type="button"
              className="btn-text"
              disabled={Boolean(busyKey)}
              onClick={() =>
                void onAction(`unban-t:${m.id}`, {
                  action: "unban_traveller",
                  travellerId: m.travellerId,
                })
              }
            >
              {busyKey === `unban-t:${m.id}` ? "[ … ]" : "[ UNBAN ]"}
            </button>
          </>
        ) : null}

        {m.profileId && m.authorType !== "traveller" ? (
          <>
            {CLEARING_MUTE_PRESETS_SECONDS.map((sec) => (
              <button
                key={sec}
                type="button"
                className="btn-text"
                disabled={Boolean(busyKey)}
                onClick={() =>
                  void onAction(`mute-o:${m.id}:${sec}`, {
                    action: "mute_outlaw",
                    profileId: m.profileId,
                    muteSeconds: sec,
                    targetLabel: m.authorLabel,
                  })
                }
              >
                {busyKey === `mute-o:${m.id}:${sec}`
                  ? "[ … ]"
                  : `[ MUTE ${muteLabel(sec).toUpperCase()} ]`}
              </button>
            ))}
            <button
              type="button"
              className="btn-text"
              disabled={Boolean(busyKey)}
              onClick={() =>
                void onAction(`unmute-o:${m.id}`, {
                  action: "unmute_outlaw",
                  profileId: m.profileId,
                  targetLabel: m.authorLabel,
                })
              }
            >
              {busyKey === `unmute-o:${m.id}` ? "[ … ]" : "[ UNMUTE ]"}
            </button>
            <button
              type="button"
              className="btn-text"
              disabled={Boolean(busyKey)}
              onClick={() =>
                void onAction(`ban-o:${m.id}`, {
                  action: "ban_outlaw",
                  profileId: m.profileId,
                  targetLabel: m.authorLabel,
                })
              }
            >
              {busyKey === `ban-o:${m.id}` ? "[ … ]" : "[ BAN ]"}
            </button>
            <button
              type="button"
              className="btn-text"
              disabled={Boolean(busyKey)}
              onClick={() =>
                void onAction(`unban-o:${m.id}`, {
                  action: "unban_outlaw",
                  profileId: m.profileId,
                  targetLabel: m.authorLabel,
                })
              }
            >
              {busyKey === `unban-o:${m.id}` ? "[ … ]" : "[ UNBAN ]"}
            </button>
          </>
        ) : null}
      </div>
    </li>
  );
}
