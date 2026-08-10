"use client";

import { useCallback, useEffect, useState } from "react";

import { useDeskGate } from "@/components/desk/desk-gate";
import type {
  EditorialDailyOverview,
  EditorialRoomSnapshot,
  SafeEditorialRun,
  SafeEditorialTransmission,
} from "@/lib/editorial/types";

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function OverviewBlock({ overview }: { overview: EditorialDailyOverview }) {
  const headlines = overview.newsroomHeadlines ?? [];
  return (
    <div className="desk-editorial__overview">
      <p className="muted">TODAY IN THE WOOD</p>
      {headlines.length > 0 ? (
        <ul className="desk-member__facts desk-editorial__newsroom">
          {headlines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          {overview.quiet
            ? "A quiet day. Stillness is allowed."
            : "Today's world has been read."}
        </p>
      )}
      <ul className="desk-member__facts">
        <li>
          Book
          <br />
          {overview.bookWritten ? "✓" : "—"}
        </li>
        <li>
          Fire
          <br />
          {overview.fireWaitingCount} waiting
        </li>
        <li>
          Gathering
          <br />
          {overview.gatheringLabel}
        </li>
        <li>
          New Outlaws
          <br />
          {overview.newOutlaws}
        </li>
        <li>
          New Deeds
          <br />
          {overview.newDeedsApproved}
        </li>
        <li>
          Greenwood arrivals
          <br />
          {overview.greenwoodArrivals}
        </li>
        <li>
          Wall
          <br />
          {overview.wallMarks} new marks
        </li>
        <li>
          Treasury
          <br />
          {overview.treasuryLabel}
        </li>
        <li>
          Robinhood Chain
          <br />
          {overview.robinhoodLabel}
        </li>
      </ul>
    </div>
  );
}

function TransmissionCard({
  item,
  busyId,
  onCopy,
  onEdit,
  onRegenerate,
  onApprove,
}: {
  item: SafeEditorialTransmission;
  busyId: string | null;
  onCopy: (t: SafeEditorialTransmission) => void;
  onEdit: (t: SafeEditorialTransmission, body: string) => void;
  onRegenerate: (t: SafeEditorialTransmission) => void;
  onApprove: (t: SafeEditorialTransmission) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.body);
  const busy = busyId === item.id;
  const modeLabel = item.modeLabel ?? item.categoryLabel;

  return (
    <article className="desk-editorial__tx" aria-label={modeLabel}>
      <h3 className="desk-editorial__tx-cat">
        {modeLabel}
        {item.grounded ? " · FROM TODAY" : ""}
        {item.approvalState === "approved" ? " · APPROVED" : ""}
      </h3>
      <p className="desk-editorial__tx-title muted">{item.title}</p>
      {editing ? (
        <textarea
          className="desk-editorial__editor"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={6}
          aria-label="Edit transmission body"
        />
      ) : (
        <pre className="desk-editorial__body ascii">{item.body}</pre>
      )}
      <p className="muted desk-editorial__meta">
        Operator note: {item.operatorRationale}
      </p>
      <p className="muted desk-editorial__meta">
        Sources:{" "}
        {item.sourceSignals.length > 0
          ? item.sourceSignals.join(", ")
          : "—"}
      </p>
      <p className="muted desk-editorial__meta">
        Confidence: {item.confidence}
        {item.copyCount > 0 ? ` · copied ${item.copyCount}` : ""}
      </p>
      <div className="desk-editorial__actions">
        {editing ? (
          <>
            <button
              type="button"
              className="btn-text"
              disabled={busy}
              onClick={() => {
                onEdit(item, draft);
                setEditing(false);
              }}
            >
              [ SAVE ]
            </button>
            <button
              type="button"
              className="btn-text"
              disabled={busy}
              onClick={() => {
                setDraft(item.body);
                setEditing(false);
              }}
            >
              [ CANCEL ]
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn-text"
              disabled={busy}
              onClick={() => onCopy(item)}
            >
              [ COPY ]
            </button>
            <button
              type="button"
              className="btn-text"
              disabled={busy}
              onClick={() => {
                setDraft(item.body);
                setEditing(true);
              }}
            >
              [ EDIT ]
            </button>
            <button
              type="button"
              className="btn-text"
              disabled={busy}
              onClick={() => onRegenerate(item)}
            >
              [ REGENERATE ]
            </button>
            <button
              type="button"
              className="btn-text"
              disabled={busy || item.approvalState === "approved"}
              onClick={() => onApprove(item)}
            >
              [ APPROVE ]
            </button>
          </>
        )}
      </div>
    </article>
  );
}

/**
 * THE EDITORIAL ROOM — Desk operator surface for daily transmission drafts.
 * No automatic X posting.
 */
export function DeskEditorialPanel() {
  const { getAuthHeaders } = useDeskGate();
  const [room, setRoom] = useState<EditorialRoomSnapshot | null>(null);
  const [run, setRun] = useState<SafeEditorialRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [whatMattersToday, setWhatMattersToday] = useState("");
  const [keeperContext, setKeeperContext] = useState("");
  const [keeperBusy, setKeeperBusy] = useState(false);
  const [keeperError, setKeeperError] = useState<string | null>(null);
  const [keeperResult, setKeeperResult] = useState<{
    body: string;
    title: string;
    recoveryUsed: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setError("Could not open The Editorial Room.");
      setRoom(null);
      return;
    }
    const response = await fetch("/api/desk/editorial", {
      headers,
      cache: "no-store",
    });
    const data = (await response.json()) as {
      ok?: boolean;
      room?: EditorialRoomSnapshot;
      error?: string;
    };
    if (!response.ok || !data.room) {
      setError(data.error ?? "Editorial Room could not be read.");
      setRoom(null);
      return;
    }
    setRoom(data.room);
    setRun(data.room.latestRun);
    const stored = data.room.latestRun?.editorialBrief?.whatMattersToday;
    if (typeof stored === "string" && stored.trim()) {
      setWhatMattersToday(stored);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function patchTransmission(next: SafeEditorialTransmission) {
    setRun((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        transmissions: prev.transmissions.map((t) =>
          t.id === next.id ? next : t,
        ),
        approvedCount: prev.transmissions
          .map((t) => (t.id === next.id ? next : t))
          .filter((t) => t.approvalState === "approved").length,
        draftCount: prev.transmissions
          .map((t) => (t.id === next.id ? next : t))
          .filter((t) => t.approvalState === "draft").length,
      };
    });
  }

  async function prepare() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch("/api/desk/editorial/generate", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: true,
          whatMattersToday: whatMattersToday.trim() || null,
        }),
        cache: "no-store",
      });
      const data = (await response.json()) as {
        ok?: boolean;
        run?: SafeEditorialRun;
        error?: string;
      };
      if (!response.ok || !data.run) {
        setError(data.error ?? "Generation failed.");
        return;
      }
      setRun(data.run);
      setStatus("Thirty transmissions prepared.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function onCopy(item: SafeEditorialTransmission) {
    const ok = await copyText(item.body);
    setFeedback(ok ? "copied." : "could not copy.");
    window.setTimeout(() => setFeedback(""), 2000);
    if (!ok) return;
    const headers = await getAuthHeaders();
    if (!headers) return;
    void fetch(`/api/desk/editorial/transmissions/${item.id}/copy`, {
      method: "POST",
      headers,
      cache: "no-store",
    }).then(async (response) => {
      if (!response.ok) return;
      const data = (await response.json()) as { copyCount?: number };
      if (typeof data.copyCount === "number") {
        patchTransmission({ ...item, copyCount: data.copyCount });
      }
    });
  }

  async function onEdit(item: SafeEditorialTransmission, body: string) {
    setBusyId(item.id);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch(
        `/api/desk/editorial/transmissions/${item.id}`,
        {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ editedBody: body }),
          cache: "no-store",
        },
      );
      const data = (await response.json()) as {
        transmission?: SafeEditorialTransmission;
        error?: string;
      };
      if (!response.ok || !data.transmission) {
        setError(data.error ?? "Edit failed.");
        return;
      }
      patchTransmission(data.transmission);
      setStatus("Transmission edited.");
    } finally {
      setBusyId(null);
    }
  }

  async function onRegenerate(item: SafeEditorialTransmission) {
    setBusyId(item.id);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch(
        `/api/desk/editorial/transmissions/${item.id}/regenerate`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true }),
          cache: "no-store",
        },
      );
      const data = (await response.json()) as {
        transmission?: SafeEditorialTransmission;
        error?: string;
      };
      if (!response.ok || !data.transmission) {
        setError(data.error ?? "Regeneration failed.");
        return;
      }
      patchTransmission(data.transmission);
      setStatus("Transmission regenerated.");
    } finally {
      setBusyId(null);
    }
  }

  async function onApprove(item: SafeEditorialTransmission) {
    setBusyId(item.id);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch(
        `/api/desk/editorial/transmissions/${item.id}/approve`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true }),
          cache: "no-store",
        },
      );
      const data = (await response.json()) as {
        transmission?: SafeEditorialTransmission;
        error?: string;
      };
      if (!response.ok || !data.transmission) {
        setError(data.error ?? "Approve failed.");
        return;
      }
      patchTransmission(data.transmission);
      setStatus("Transmission approved for manual posting.");
    } finally {
      setBusyId(null);
    }
  }

  async function speakOnce() {
    if (keeperBusy) return;
    setKeeperBusy(true);
    setKeeperError(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) {
        setKeeperError("Could not open The Editorial Room.");
        return;
      }
      const response = await fetch("/api/desk/editorial/speak-once", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ keeperContext: keeperContext.trim() }),
        cache: "no-store",
      });
      const data = (await response.json()) as {
        ok?: boolean;
        transmission?: { body?: string; title?: string };
        recoveryUsed?: boolean;
        error?: string;
      };
      if (!response.ok || !data.transmission?.body) {
        setKeeperError(data.error ?? "Generation failed.");
        return;
      }
      setKeeperResult({
        body: data.transmission.body,
        title:
          typeof data.transmission.title === "string"
            ? data.transmission.title
            : "",
        recoveryUsed: Boolean(data.recoveryUsed),
      });
    } finally {
      setKeeperBusy(false);
    }
  }

  async function copyKeeperBody() {
    if (!keeperResult?.body) return;
    const ok = await copyText(keeperResult.body);
    setFeedback(ok ? "copied." : "could not copy.");
    window.setTimeout(() => setFeedback(""), 2000);
  }

  return (
    <section className="desk-editorial" aria-label="The Editorial Room">
      <div className="desk-hollow__head">
        <h2 className="desk-section-title">THE EDITORIAL ROOM</h2>
        <button type="button" className="btn-text" onClick={() => void load()}>
          [ refresh ]
        </button>
      </div>
      <p className="muted">
        Drafts for the road. Nothing leaves this room unless you carry it.
      </p>

      {status ? <p>{status}</p> : null}
      {error ? <p className="muted">{error}</p> : null}
      <p className="desk-editorial__feedback" aria-live="polite">
        {feedback}
      </p>
      {!room && !error ? <p className="muted">…</p> : null}

      {room ? (
        <>
          <OverviewBlock overview={room.overview} />

          <div className="desk-editorial__prepare">
            <label className="desk-editorial__intent">
              <span className="muted">WHAT MATTERS TODAY</span>
              <textarea
                className="desk-editorial__editor"
                value={whatMattersToday}
                onChange={(e) => setWhatMattersToday(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="Optional. One thought or several lines for the desk."
                aria-label="What matters today"
              />
            </label>
            <button
              type="button"
              className="btn-text"
              disabled={busy}
              onClick={() => void prepare()}
            >
              [ PREPARE TODAY&apos;S TRANSMISSIONS ]
            </button>
            <p className="muted">
              One reading of the world. Thirty drafts. Manual posting only.
            </p>
            {run?.createdAt ? (
              <p className="muted">
                Last prepared {new Date(run.createdAt).toLocaleString()}
              </p>
            ) : null}
          </div>

          <div className="desk-editorial__prepare desk-editorial__keeper">
            <h3 className="desk-overview__group-title">
              ONE WORD FROM THE KEEPER
            </h3>
            <p className="muted">Give FENN something to speak about.</p>
            <label className="desk-editorial__intent">
              <span className="muted">SITUATION</span>
              <textarea
                className="desk-editorial__editor"
                value={keeperContext}
                onChange={(e) => setKeeperContext(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="A situation, atmosphere, or direction — not trusted as fact."
                aria-label="Keeper situational context"
                disabled={keeperBusy}
              />
            </label>
            <button
              type="button"
              className="btn-text"
              disabled={keeperBusy || !keeperContext.trim()}
              onClick={() => void speakOnce()}
            >
              {keeperBusy ? "[ WRITING… ]" : "[ GENERATE ]"}
            </button>
            {keeperBusy ? (
              <p className="muted">FENN is writing one transmission.</p>
            ) : null}
            {keeperError ? <p className="muted">{keeperError}</p> : null}
            {keeperResult ? (
              <article
                className="desk-editorial__tx"
                aria-label="Keeper transmission"
              >
                {keeperResult.title ? (
                  <p className="desk-editorial__tx-title muted">
                    {keeperResult.title}
                  </p>
                ) : null}
                <pre className="desk-editorial__body ascii">
                  {keeperResult.body}
                </pre>
                <div className="desk-editorial__actions">
                  <button
                    type="button"
                    className="btn-text"
                    disabled={keeperBusy}
                    onClick={() => void copyKeeperBody()}
                  >
                    [ COPY ]
                  </button>
                  <button
                    type="button"
                    className="btn-text"
                    disabled={keeperBusy || !keeperContext.trim()}
                    onClick={() => void speakOnce()}
                  >
                    [ GENERATE AGAIN ]
                  </button>
                </div>
                {keeperResult.recoveryUsed ? (
                  <p className="muted">Rewritten once for quality.</p>
                ) : null}
              </article>
            ) : null}
          </div>

          {run ? (
            <>
              <h3 className="desk-overview__group-title">
                TODAY&apos;S PACKAGE · {run.coveredDate}
              </h3>
              <p className="muted">
                {run.approvedCount} approved · {run.draftCount} draft
                {run.promptVersion ? ` · ${run.promptVersion}` : ""}
              </p>
              <div className="desk-editorial__list">
                {run.transmissions.map((item) => (
                  <TransmissionCard
                    key={item.id}
                    item={item}
                    busyId={busyId}
                    onCopy={(t) => void onCopy(t)}
                    onEdit={(t, body) => void onEdit(t, body)}
                    onRegenerate={(t) => void onRegenerate(t)}
                    onApprove={(t) => void onApprove(t)}
                  />
                ))}
              </div>
            </>
          ) : (
            <p className="muted">No package prepared for today yet.</p>
          )}
        </>
      ) : null}
    </section>
  );
}
