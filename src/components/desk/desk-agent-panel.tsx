"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useDeskGate } from "@/components/desk/desk-gate";
import type { DeskAgentHealth } from "@/lib/desk/agent";

type WallTestUiStatus =
  | "idle"
  | "confirm"
  | "running"
  | "created"
  | "already_present"
  | "failed";

export function DeskAgentPanel() {
  const { getAuthHeaders } = useDeskGate();
  const [agent, setAgent] = useState<DeskAgentHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOauth, setConfirmOauth] = useState(false);
  const [wallTestUi, setWallTestUi] = useState<WallTestUiStatus>("idle");
  const [wallTestWallId, setWallTestWallId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setError("Could not open The Agent.");
      setAgent(null);
      return;
    }
    const response = await fetch("/api/desk/agent", {
      headers,
      cache: "no-store",
    });
    const data = (await response.json()) as {
      ok?: boolean;
      agent?: DeskAgentHealth;
      error?: string;
    };
    if (!response.ok || !data.agent) {
      setError(data.error ?? "Agent health could not be loaded.");
      setAgent(null);
      return;
    }
    setAgent(data.agent);
  }, [getAuthHeaders]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void load();
    }, 45_000);
    return () => window.clearInterval(interval);
  }, [load]);

  async function startOauth() {
    const headers = await getAuthHeaders();
    if (!headers) return;
    const response = await fetch("/api/desk/agent/oauth/start", {
      method: "POST",
      headers,
      cache: "no-store",
    });
    const data = (await response.json()) as {
      authorizationUrl?: string;
      error?: string;
    };
    if (!response.ok || !data.authorizationUrl) {
      setError(data.error ?? "OAuth could not be started.");
      return;
    }
    window.location.href = data.authorizationUrl;
  }

  async function runWallTest() {
    setWallTestUi("running");
    setWallTestWallId(null);
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setWallTestUi("failed");
      setError("Could not authenticate for Wall test.");
      return;
    }
    try {
      const response = await fetch("/api/desk/agent/wall-test", {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        // Body is confirmation only — inscription comes from the server.
        body: JSON.stringify({ confirm: true }),
        cache: "no-store",
      });
      const data = (await response.json()) as {
        ok?: boolean;
        status?: "created" | "already_present" | "failed";
        wallEntryId?: string;
        error?: string;
      };
      if (!response.ok || !data.ok) {
        setWallTestUi("failed");
        void load();
        return;
      }
      setWallTestWallId(data.wallEntryId ?? null);
      setWallTestUi(
        data.status === "already_present" ? "already_present" : "created",
      );
      void load();
    } catch {
      setWallTestUi("failed");
    }
  }

  return (
    <section className="desk-agent" aria-label="The Agent">
      <div className="desk-hollow__head">
        <h2 className="desk-section-title">THE AGENT</h2>
        <button type="button" className="btn-text" onClick={() => void load()}>
          [ refresh ]
        </button>
      </div>
      <p className="muted">Is FENN able to see, think and speak?</p>
      <p className="muted">
        Health, OAuth, and a single controlled Wall test. Pipeline cron remains
        outside The Desk.
      </p>
      {error ? <p className="muted">{error}</p> : null}
      {!agent && !error ? <p className="muted">…</p> : null}
      {agent ? (
        <>
          <h3 className="desk-overview__group-title">IDENTITY</h3>
          <ul className="desk-member__facts">
            <li>@{agent.identity.configuredUsername ?? "askfenn"}</li>
            <li>
              OAuth: {agent.identity.oauthBound ? "BOUND" : "NOT BOUND"}
              {agent.identity.oauthUsername
                ? ` (@${agent.identity.oauthUsername})`
                : ""}
            </li>
            <li>Token expiry: {agent.identity.tokenExpiryState}</li>
            <li>Updated: {agent.identity.oauthUpdatedAt ?? "—"}</li>
            <li>
              {!confirmOauth ? (
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => setConfirmOauth(true)}
                >
                  [ prepare OAuth bind ]
                </button>
              ) : (
                <div className="desk-gatherings__confirm">
                  <p>BIND ASKFENN OAUTH</p>
                  <p className="muted">
                    Starts the @askfenn OAuth binding flow. Tokens are never
                    shown in The Desk. Pipeline execution remains outside The
                    Desk.
                  </p>
                  <button
                    type="button"
                    className="btn-text"
                    onClick={() => void startOauth()}
                  >
                    [ confirm OAuth bind ]
                  </button>
                  <button
                    type="button"
                    className="btn-text"
                    onClick={() => setConfirmOauth(false)}
                  >
                    [ cancel ]
                  </button>
                </div>
              )}
            </li>
          </ul>

          <h3 className="desk-overview__group-title">PERCEPTION</h3>
          <ul className="desk-member__facts">
            <li>
              pending {agent.perception.pending} · processing{" "}
              {agent.perception.processing} · processed{" "}
              {agent.perception.completed} · failed {agent.perception.failed}
            </li>
            <li>Last poll update: {agent.perception.lastPollAt ?? "—"}</li>
            <li>Cursor: {agent.perception.cursorPresent ? "present" : "empty"}</li>
          </ul>

          <h3 className="desk-overview__group-title">MIND</h3>
          <ul className="desk-member__facts">
            <li>
              awaiting {agent.judgement.pending} · processing{" "}
              {agent.judgement.processing} · formed {agent.judgement.completed} ·
              failed {agent.judgement.failed}
            </li>
            <li>
              Authority — permitted {agent.authority.authorised} · denied{" "}
              {agent.authority.denied} · no action {agent.authority.noAction}
            </li>
          </ul>

          <h3 className="desk-overview__group-title">EFFECTS</h3>
          <ul className="desk-member__facts">
            <li>
              pending {agent.effects.pending} · processing{" "}
              {agent.effects.processing} · completed {agent.effects.completed} ·
              failed {agent.effects.failed}
            </li>
            <li>
              Latest external result: {agent.effects.latestExternalResultId ?? "—"}
            </li>
          </ul>

          <h3 className="desk-overview__group-title">WALL EFFECT TEST</h3>
          <div className="desk-agent__wall-test">
            <p className="muted">
              This sends one controlled inscription through the agent’s trusted
              Wall path.
            </p>
            <p className="muted">It does not post to X.</p>

            {wallTestUi === "idle" || wallTestUi === "confirm" ? (
              wallTestUi === "idle" ? (
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => setWallTestUi("confirm")}
                >
                  [ TEST WALL EFFECT ]
                </button>
              ) : (
                <div className="desk-gatherings__confirm">
                  <p>TEST THE AGENT AGAINST THE WALL?</p>
                  <p className="muted">
                    One controlled inscription will be written. Nothing will be
                    sent to X.
                  </p>
                  <button
                    type="button"
                    className="btn-text"
                    onClick={() => void runWallTest()}
                  >
                    [ CONFIRM WALL TEST ]
                  </button>
                  <button
                    type="button"
                    className="btn-text"
                    onClick={() => setWallTestUi("idle")}
                  >
                    [ CANCEL ]
                  </button>
                </div>
              )
            ) : null}

            {wallTestUi === "running" ? (
              <p className="muted" aria-live="polite">
                …
              </p>
            ) : null}

            {wallTestUi === "created" ? (
              <div className="desk-agent__wall-test-result" aria-live="polite">
                <p>THE AGENT REACHED THE WALL.</p>
                <p className="muted">
                  One controlled inscription was written.
                  <br />
                  Nothing was sent to X.
                </p>
                <p>
                  <Link href="/wall" className="btn-text">
                    [ VIEW THE WALL ]
                  </Link>
                </p>
              </div>
            ) : null}

            {wallTestUi === "already_present" ? (
              <div className="desk-agent__wall-test-result" aria-live="polite">
                <p>THE TEST MARK IS ALREADY ON THE WALL.</p>
                <p className="muted">No second inscription was written.</p>
                <p>
                  <Link href="/wall" className="btn-text">
                    [ VIEW THE WALL ]
                  </Link>
                </p>
              </div>
            ) : null}

            {wallTestUi === "failed" ? (
              <div className="desk-agent__wall-test-result" aria-live="polite">
                <p>THE MACHINE DID NOT REACH THE WALL.</p>
                <p className="muted">No X action was attempted.</p>
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => setWallTestUi("idle")}
                >
                  [ DISMISS ]
                </button>
              </div>
            ) : null}

            {wallTestWallId ? (
              <p className="muted">Wall entry: {wallTestWallId}</p>
            ) : null}
          </div>

          <h3 className="desk-overview__group-title">LAST WALL TEST</h3>
          <ul className="desk-member__facts">
            <li>
              {agent.lastWallTest.status === "none"
                ? "none yet"
                : agent.lastWallTest.status}
            </li>
            <li>
              Timestamp:{" "}
              {agent.lastWallTest.completedAt ??
                agent.lastWallTest.updatedAt ??
                "—"}
            </li>
            <li>
              Wall entry: {agent.lastWallTest.wallEntryId ?? "—"}
            </li>
            <li>Test version: v{agent.lastWallTest.testVersion}</li>
          </ul>

          <h3 className="desk-overview__group-title">WARNINGS</h3>
          {agent.warnings.length === 0 ? (
            <p className="muted">None.</p>
          ) : (
            <ul className="desk-member__list">
              {agent.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}

          <h3 className="desk-overview__group-title">RECENT ACTIONS</h3>
          {agent.recentActions.length === 0 ? (
            <p className="muted">None recorded.</p>
          ) : (
            <ul className="desk-member__list">
              {agent.recentActions.map((a, i) => (
                <li key={`${a.updatedAt}-${i}`}>
                  {a.effectType} · {a.status}
                  {a.externalResultId ? ` · ${a.externalResultId}` : ""}
                  {a.updatedAt ? ` · ${a.updatedAt}` : ""}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
