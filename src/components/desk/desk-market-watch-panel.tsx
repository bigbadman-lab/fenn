"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useDeskGate } from "@/components/desk/desk-gate";
import type {
  MarketWatchDeskEventFilter,
  MarketWatchDeskSnapshot,
} from "@/lib/market-watch/desk-types";
import { MARKET_WATCH_DESK_POLL_MS } from "@/lib/market-watch/desk-types";

const POLL_MS = MARKET_WATCH_DESK_POLL_MS;

const FILTERS: { id: MarketWatchDeskEventFilter; label: string }[] = [
  { id: "all", label: "ALL" },
  { id: "acquisitions", label: "ACQUISITIONS" },
  { id: "disposals", label: "DISPOSALS" },
  { id: "published", label: "PUBLISHED" },
  { id: "observed", label: "OBSERVED" },
  { id: "suppressed", label: "SUPPRESSED" },
  { id: "reorged", label: "REORGED" },
];

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = Date.parse(iso);
  if (!Number.isFinite(d)) return iso;
  return new Date(d).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function heartbeatLine(s: MarketWatchDeskSnapshot["heartbeat"]): string {
  if (s.status === "absent") return "ABSENT";
  if (s.status === "current") return "CURRENT";
  const age = s.ageSeconds ?? 0;
  const m = Math.floor(age / 60);
  const sec = age % 60;
  return `STALE — ${m}m ${sec}s`;
}

export function DeskMarketWatchPanel() {
  const { getAuthHeaders } = useDeskGate();
  const [snapshot, setSnapshot] = useState<MarketWatchDeskSnapshot | null>(
    null,
  );
  const [filter, setFilter] = useState<MarketWatchDeskEventFilter>("all");
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const inFlight = useRef(false);
  const requestSeq = useRef(0);

  const load = useCallback(
    async (opts?: {
      quiet?: boolean;
      cursor?: string | null;
      append?: boolean;
    }) => {
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

      const seq = ++requestSeq.current;
      try {
        const params = new URLSearchParams({ filter });
        if (opts?.cursor) params.set("cursor", opts.cursor);
        const response = await fetch(`/api/desk/market-watch?${params}`, {
          headers,
          cache: "no-store",
        });
        const data = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          marketWatch?: MarketWatchDeskSnapshot;
          error?: string;
        };
        if (seq < requestSeq.current && !opts?.append) {
          // A newer request completed; ignore stale payload.
          return;
        }
        if (!response.ok || !data.ok || !data.marketWatch) {
          setError(data.error ?? "Market Watch could not be read.");
          setLoading(false);
          return;
        }
        if (opts?.append) {
          setSnapshot((prev) => {
            if (!prev) return data.marketWatch ?? null;
            const seen = new Set(prev.events.map((e) => e.id));
            const extra = (data.marketWatch?.events ?? []).filter(
              (e) => !seen.has(e.id),
            );
            return {
              ...data.marketWatch!,
              events: [...prev.events, ...extra],
              nextCursor: data.marketWatch?.nextCursor ?? null,
            };
          });
        } else {
          setSnapshot(data.marketWatch);
        }
        setRefreshedAt(new Date().toISOString());
        setLoading(false);
      } catch {
        setError("Market Watch could not be read.");
        setLoading(false);
      } finally {
        inFlight.current = false;
      }
    },
    [filter, getAuthHeaders],
  );

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    let timer: number | null = null;
    const tick = () => {
      if (document.visibilityState === "hidden") return;
      void load({ quiet: true });
    };
    const schedule = () => {
      if (timer != null) window.clearInterval(timer);
      timer = window.setInterval(tick, POLL_MS);
    };
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void load({ quiet: true });
        schedule();
      } else if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    schedule();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (timer != null) window.clearInterval(timer);
    };
  }, [load]);

  const loadOlder = async () => {
    if (!snapshot?.nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      await load({ cursor: snapshot.nextCursor, append: true });
    } finally {
      setLoadingOlder(false);
    }
  };

  const detail = snapshot?.events.find((e) => e.id === detailId) ?? null;

  return (
    <div className="desk-mw">
      <header className="desk-mw__header">
        <h1 className="desk__title">MARKET WATCH</h1>
        <p className="desk-mw__lede muted">
          Keeper view of the official $VELL market observer.
        </p>
      </header>

      {loading && !snapshot ? (
        <p className="muted" role="status">
          Reading Market Watch…
        </p>
      ) : null}

      {error ? (
        <p className="desk-mw__error" role="alert">
          {error}
        </p>
      ) : null}

      {snapshot ? (
        <>
          <section
            className="desk-mw__verdict"
            aria-labelledby="desk-mw-verdict"
          >
            <h2 id="desk-mw-verdict" className="desk-mw__h">
              READINESS
            </h2>
            <p className="desk-mw__verdict-label" role="status">
              {snapshot.verdictLabel}
            </p>
            <p className="muted desk-mw__line">{snapshot.runtime.effectiveLine}</p>
          </section>

          {snapshot.warnings.length > 0 ? (
            <section
              className="desk-mw__warnings"
              aria-labelledby="desk-mw-warnings"
            >
              <h2 id="desk-mw-warnings" className="desk-mw__h">
                WARNINGS
              </h2>
              <ul className="desk-mw__warn-list">
                {snapshot.warnings.map((w) => (
                  <li key={w.code}>
                    <span className="desk-mw__warn-msg">{w.message}</span>
                    <span className="muted desk-mw__code"> {w.code}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section
            className="desk-mw__section"
            aria-labelledby="desk-mw-runtime"
          >
            <h2 id="desk-mw-runtime" className="desk-mw__h">
              RUNTIME MODE
            </h2>
            <dl className="desk-mw__dl">
              <div>
                <dt>WORKER MODE</dt>
                <dd>{snapshot.runtime.workerMode.toUpperCase()}</dd>
              </div>
              <div>
                <dt>CONFIG ENABLED</dt>
                <dd>{snapshot.runtime.configEnabled ? "YES" : "NO"}</dd>
              </div>
              <div>
                <dt>MODE SOURCE</dt>
                <dd>ENVIRONMENT (Render)</dd>
              </div>
            </dl>
            <p className="muted desk-mw__line">{snapshot.runtime.modeGuidance}</p>
            <p className="desk-mw__activation" role="note">
              {snapshot.liveActivationNote}
            </p>
          </section>

          <section
            className="desk-mw__section"
            aria-labelledby="desk-mw-config"
          >
            <h2 id="desk-mw-config" className="desk-mw__h">
              CONFIGURATION
            </h2>
            {!snapshot.config.complete ? (
              <div>
                <p className="desk-mw__missing-title">MISSING</p>
                <ul className="desk-mw__missing">
                  {snapshot.config.missingFields.map((f) => (
                    <li key={f}>{f.replace(/_/g, " ").toUpperCase()}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <dl className="desk-mw__dl">
              <div>
                <dt>CHAIN ID</dt>
                <dd>{snapshot.config.chainId}</dd>
              </div>
              <div>
                <dt>TOKEN</dt>
                <dd>
                  {snapshot.config.tokenSymbol ?? "—"}{" "}
                  {snapshot.config.tokenAddressFull ? (
                    <a
                      className="btn-text"
                      href={snapshot.config.tokenExplorerUrl ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={snapshot.config.tokenAddressFull}
                      aria-label={`Token ${snapshot.config.tokenAddressFull}`}
                    >
                      {snapshot.config.tokenAddressShort}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt>POOL</dt>
                <dd>
                  {snapshot.config.poolKind ?? "—"}{" "}
                  {snapshot.config.poolAddressFull ? (
                    <a
                      className="btn-text"
                      href={snapshot.config.poolExplorerUrl ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={snapshot.config.poolAddressFull}
                      aria-label={`Pool ${snapshot.config.poolAddressFull}`}
                    >
                      {snapshot.config.poolAddressShort}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt>QUOTE</dt>
                <dd>
                  {snapshot.config.quoteTokenSymbol ?? "—"}{" "}
                  {snapshot.config.quoteTokenAddressFull ? (
                    <a
                      className="btn-text"
                      href={snapshot.config.quoteExplorerUrl ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={snapshot.config.quoteTokenAddressFull}
                      aria-label={`Quote token ${snapshot.config.quoteTokenAddressFull}`}
                    >
                      {snapshot.config.quoteTokenAddressShort}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt>LAUNCH BLOCK</dt>
                <dd>{snapshot.config.launchBlock ?? "—"}</dd>
              </div>
              <div>
                <dt>CONFIRMATION DEPTH</dt>
                <dd>{snapshot.config.confirmationDepth ?? "—"}</dd>
              </div>
              <div>
                <dt>MIN DISPLAY</dt>
                <dd>{snapshot.config.minDisplayFennLabel ?? "—"}</dd>
              </div>
              <div>
                <dt>CLASSIFICATION</dt>
                <dd>{snapshot.config.classificationVersion ?? "—"}</dd>
              </div>
              <div>
                <dt>ENABLED</dt>
                <dd>{snapshot.config.enabled ? "YES" : "NO"}</dd>
              </div>
            </dl>
          </section>

          <section
            className="desk-mw__section"
            aria-labelledby="desk-mw-heart"
          >
            <h2 id="desk-mw-heart" className="desk-mw__h">
              HEARTBEAT
            </h2>
            <p className="desk-mw__heart-status">{heartbeatLine(snapshot.heartbeat)}</p>
            <dl className="desk-mw__dl">
              <div>
                <dt>LAST TICK</dt>
                <dd>
                  <time dateTime={snapshot.heartbeat.lastTickAt ?? undefined}>
                    {formatWhen(snapshot.heartbeat.lastTickAt)}
                  </time>
                </dd>
              </div>
              <div>
                <dt>LAST SUCCESS</dt>
                <dd>
                  <time dateTime={snapshot.heartbeat.lastSuccessAt ?? undefined}>
                    {formatWhen(snapshot.heartbeat.lastSuccessAt)}
                  </time>
                </dd>
              </div>
              <div>
                <dt>LAST ERROR</dt>
                <dd>
                  <time dateTime={snapshot.heartbeat.lastErrorAt ?? undefined}>
                    {formatWhen(snapshot.heartbeat.lastErrorAt)}
                  </time>
                  {snapshot.heartbeat.lastErrorCode ? (
                    <span className="muted desk-mw__code">
                      {" "}
                      {snapshot.heartbeat.lastErrorCode}
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>VERSION</dt>
                <dd>{snapshot.heartbeat.workerVersion ?? "—"}</dd>
              </div>
              <div>
                <dt>LEASE</dt>
                <dd>
                  {snapshot.heartbeat.leaseHeld
                    ? snapshot.heartbeat.leaseHolderLabel ?? "HELD"
                    : "FREE / UNKNOWN"}
                </dd>
              </div>
            </dl>
            {snapshot.heartbeat.lastErrorPlain ? (
              <p className="desk-mw__plain">{snapshot.heartbeat.lastErrorPlain}</p>
            ) : null}
          </section>

          <section
            className="desk-mw__section"
            aria-labelledby="desk-mw-cursor"
          >
            <h2 id="desk-mw-cursor" className="desk-mw__h">
              CURSOR
            </h2>
            <p className="desk-mw__cursor-line">
              {snapshot.cursor.exists
                ? `${snapshot.cursor.lastProcessedBlock ?? "—"} / ${snapshot.cursor.latestChainBlock ?? "—"}`
                : "NOT INITIALISED"}
            </p>
            <p className="muted">{snapshot.cursor.stateLine}</p>
            <dl className="desk-mw__dl">
              <div>
                <dt>LAG (BLOCKS)</dt>
                <dd>
                  {snapshot.cursor.cursorLagBlocks != null
                    ? snapshot.cursor.cursorLagBlocks.toLocaleString("en-US")
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>CONFIRMATION DEPTH</dt>
                <dd>{snapshot.cursor.confirmationDepth ?? "—"}</dd>
              </div>
              <div>
                <dt>LAUNCH BLOCK</dt>
                <dd>{snapshot.cursor.launchBlock ?? "—"}</dd>
              </div>
              <div>
                <dt>SOURCE</dt>
                <dd className="desk-mw__mono">
                  {snapshot.cursor.sourceKey ?? "—"}
                </dd>
              </div>
              <div>
                <dt>SAFE HASH</dt>
                <dd className="desk-mw__mono">
                  {snapshot.cursor.lastSafeBlockHashShort ?? "—"}
                </dd>
              </div>
            </dl>
          </section>

          <section
            className="desk-mw__section"
            aria-labelledby="desk-mw-counts"
          >
            <h2 id="desk-mw-counts" className="desk-mw__h">
              CLASSIFICATION COUNTS
            </h2>
            <p className="muted">
              Operational totals — not performance metrics.
            </p>
            <dl className="desk-mw__dl desk-mw__dl--counts">
              <div>
                <dt>SEEN</dt>
                <dd>{snapshot.counts.eventsSeen.toLocaleString("en-US")}</dd>
              </div>
              <div>
                <dt>ACQUISITIONS</dt>
                <dd>
                  {snapshot.counts.acquisitionsClassified.toLocaleString(
                    "en-US",
                  )}
                </dd>
              </div>
              <div>
                <dt>DISPOSALS</dt>
                <dd>
                  {snapshot.counts.disposalsClassified.toLocaleString("en-US")}
                </dd>
              </div>
              <div>
                <dt>SUPPRESSED</dt>
                <dd>{snapshot.counts.suppressed.toLocaleString("en-US")}</dd>
              </div>
              <div>
                <dt>PUBLISHED</dt>
                <dd>{snapshot.counts.published.toLocaleString("en-US")}</dd>
              </div>
            </dl>
          </section>

          <section
            className="desk-mw__section"
            aria-labelledby="desk-mw-projection"
          >
            <h2 id="desk-mw-projection" className="desk-mw__h">
              CLEARING PROJECTION
            </h2>
            <p role="status">{snapshot.projection.line}</p>
            <p className="muted">
              Public room copy uses THE WOOD NOTICES. This Desk is operator-facing only.
            </p>
          </section>

          <section
            className="desk-mw__section"
            aria-labelledby="desk-mw-dry"
          >
            <h2 id="desk-mw-dry" className="desk-mw__h">
              DRY-RUN VERIFICATION
            </h2>
            <p>
              Classified events recorded:{" "}
              {snapshot.dryRun.classifiedAny ? "YES" : "NO"}
            </p>
            <dl className="desk-mw__dl">
              <div>
                <dt>MOST RECENT</dt>
                <dd>{formatWhen(snapshot.dryRun.recentClassifiedAt)}</dd>
              </div>
              <div>
                <dt>LAST ACQUISITION</dt>
                <dd>{formatWhen(snapshot.dryRun.lastAcquisitionAt)}</dd>
              </div>
              <div>
                <dt>LAST DISPOSAL</dt>
                <dd>{formatWhen(snapshot.dryRun.lastDisposalAt)}</dd>
              </div>
              <div>
                <dt>LAST SUPPRESSED</dt>
                <dd>{formatWhen(snapshot.dryRun.lastSuppressedAt)}</dd>
              </div>
            </dl>
            <p className="desk-mw__guidance">{snapshot.dryRun.guidance}</p>
          </section>

          <section
            className="desk-mw__section"
            aria-labelledby="desk-mw-events"
          >
            <div className="desk-mw__events-head">
              <h2 id="desk-mw-events" className="desk-mw__h">
                RECENT EVENTS
              </h2>
              <button
                type="button"
                className="btn-text"
                onClick={() => void load()}
              >
                [ REFRESH ]
              </button>
            </div>
            <div
              className="desk-mw__filters"
              role="group"
              aria-label="Event filter"
            >
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={
                    filter === f.id
                      ? "desk-mw__filter desk-mw__filter--active"
                      : "desk-mw__filter"
                  }
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {snapshot.events.length === 0 ? (
              <p className="muted">No events in this filter.</p>
            ) : (
              <ul className="desk-mw__event-list">
                {snapshot.events.map((ev) => (
                  <li key={ev.id} className="desk-mw__event">
                    <div className="desk-mw__event-top">
                      <span className="desk-mw__event-type">
                        {ev.eventType.toUpperCase()}
                      </span>
                      <span className="desk-mw__event-status">
                        {ev.status.toUpperCase()}
                      </span>
                      <time
                        className="muted"
                        dateTime={ev.observedAt}
                        title={formatWhen(ev.observedAt)}
                      >
                        {formatWhen(ev.observedAt)}
                      </time>
                    </div>
                    <p className="desk-mw__event-amt">
                      {ev.fennAmountLabel}
                      {ev.quoteAmountLabel ? (
                        <span className="muted">
                          {" "}
                          · {ev.quoteAmountLabel}
                        </span>
                      ) : null}
                    </p>
                    <p className="muted desk-mw__event-meta">
                      block {ev.blockNumber}
                      {ev.suppressReason
                        ? ` · ${ev.suppressReason}`
                        : null}
                    </p>
                    <div className="desk-mw__event-actions">
                      {ev.transactionUrl ? (
                        <a
                          className="btn-text"
                          href={ev.transactionUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`View transaction ${ev.transactionHash}`}
                        >
                          [ TX {ev.transactionHashShort} ]
                        </a>
                      ) : (
                        <span className="muted desk-mw__mono">
                          {ev.transactionHashShort}
                        </span>
                      )}
                      <button
                        type="button"
                        className="btn-text"
                        aria-expanded={detailId === ev.id}
                        onClick={() =>
                          setDetailId((cur) =>
                            cur === ev.id ? null : ev.id,
                          )
                        }
                      >
                        {detailId === ev.id ? "[ HIDE DETAIL ]" : "[ DETAIL ]"}
                      </button>
                    </div>
                    {detailId === ev.id && detail ? (
                      <div className="desk-mw__detail">
                        <dl className="desk-mw__dl">
                          <div>
                            <dt>TX</dt>
                            <dd className="desk-mw__mono">
                              {detail.transactionHash}
                            </dd>
                          </div>
                          <div>
                            <dt>LOG INDEX</dt>
                            <dd>{detail.logIndex}</dd>
                          </div>
                          <div>
                            <dt>CLASSIFICATION</dt>
                            <dd>{detail.classificationVersion}</dd>
                          </div>
                          <div>
                            <dt>PUBLISHED AT</dt>
                            <dd>{formatWhen(detail.publishedAt)}</dd>
                          </div>
                          <div>
                            <dt>POOL</dt>
                            <dd className="desk-mw__mono">
                              {detail.poolAddressShort ?? "—"}
                            </dd>
                          </div>
                          <div>
                            <dt>TOKEN</dt>
                            <dd className="desk-mw__mono">
                              {detail.tokenAddressShort ?? "—"}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {snapshot.nextCursor ? (
              <p className="desk-mw__older">
                <button
                  type="button"
                  className="btn-text"
                  disabled={loadingOlder}
                  onClick={() => void loadOlder()}
                >
                  {loadingOlder ? "[ LOADING… ]" : "[ LOAD OLDER ]"}
                </button>
              </p>
            ) : null}
          </section>

          <footer className="desk-mw__footer muted">
            <p>
              Last refreshed:{" "}
              <time dateTime={refreshedAt ?? snapshot.checkedAt}>
                {formatWhen(refreshedAt ?? snapshot.checkedAt)}
              </time>
            </p>
            <p>
              <Link href="/desk">[ desk ]</Link>
            </p>
          </footer>
        </>
      ) : null}
    </div>
  );
}
