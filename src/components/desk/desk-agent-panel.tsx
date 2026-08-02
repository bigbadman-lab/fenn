"use client";

import { useCallback, useEffect, useState } from "react";

import { useDeskGate } from "@/components/desk/desk-gate";
import type { DeskAgentHealth } from "@/lib/desk/agent";

export function DeskAgentPanel() {
  const { getAuthHeaders } = useDeskGate();
  const [agent, setAgent] = useState<DeskAgentHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOauth, setConfirmOauth] = useState(false);

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
        Health and OAuth only. Pipeline execution remains outside The Desk.
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
