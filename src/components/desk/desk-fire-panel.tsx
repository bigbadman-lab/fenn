"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useDeskGate } from "@/components/desk/desk-gate";
import type { DeskFireMember, DeskFireSnapshot } from "@/lib/desk/fire-types";

function MemberTable({
  members,
  empty,
}: {
  members: DeskFireMember[];
  empty: string;
}) {
  if (members.length === 0) {
    return <p className="muted">{empty}</p>;
  }

  return (
    <div className="desk-register__table-wrap">
      <table className="desk-register__table">
        <thead>
          <tr>
            <th>MARK</th>
            <th>OUTLAW</th>
            <th>WAITING</th>
            <th>LAST WARM</th>
            <th>HAND</th>
            <th>REGISTER</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.profileId}>
              <td>
                {member.sigil ? (
                  <pre
                    className="ascii desk-register__sigil"
                    aria-label={member.sigil.a11yLabel}
                  >
                    {member.sigil.asciiBody}
                  </pre>
                ) : (
                  <span className="muted">unmarked</span>
                )}
              </td>
              <td>
                {member.displayName}
                <div className="muted">#{member.outlawNumberLabel}</div>
              </td>
              <td>
                {member.state === "sitting"
                  ? (member.waitingLabel ?? "waiting")
                  : "—"}
              </td>
              <td className="muted">{member.lastSeenAt}</td>
              <td>{member.handRaised ? "raised" : "—"}</td>
              <td>
                <Link
                  href={`/desk/register/${member.profileId}`}
                  className="btn-text"
                >
                  [ open ]
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DeskFirePanel() {
  const { getAuthHeaders } = useDeskGate();
  const [fire, setFire] = useState<DeskFireSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(false);
    const headers = await getAuthHeaders();
    if (!headers) {
      setFire(null);
      setError(true);
      setLoading(false);
      return;
    }
    try {
      const response = await fetch("/api/desk/fire", {
        headers,
        cache: "no-store",
      });
      if (!response.ok) {
        setFire(null);
        setError(true);
        setLoading(false);
        return;
      }
      const data = (await response.json()) as {
        ok?: boolean;
        fire?: DeskFireSnapshot;
      };
      setFire(data.fire ?? null);
      setLoading(false);
    } catch {
      setFire(null);
      setError(true);
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 28_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [load]);

  const waiting =
    fire?.members.filter((m) => m.state === "sitting") ?? [];
  const warm =
    fire?.members.filter((m) => m.state === "present") ?? [];

  return (
    <section className="desk-fire" aria-label="The Fire">
      <div className="desk-overview__header">
        <h2 className="desk-section-title">THE FIRE</h2>
        <button type="button" className="btn-text" onClick={() => void load()}>
          [ refresh ]
        </button>
      </div>
      <p className="muted">WHO IS WAITING TO BE CALLED?</p>

      <p className="desk-divider" aria-hidden>
        ────────────────────
      </p>

      {loading && !fire ? <p className="muted">…</p> : null}
      {error && !fire ? (
        <p className="muted">The marks could not be read.</p>
      ) : null}

      {fire ? (
        <>
          <h3 className="desk-overview__group-title">AT THE FIRE</h3>
          {fire.activeCount === 0 ? (
            <p className="muted">The Fire is quiet.</p>
          ) : (
            <p>
              {fire.sittingCount}{" "}
              {fire.sittingCount === 1 ? "is" : "are"} waiting.
              <br />
              {fire.warmCount} mark{fire.warmCount === 1 ? "" : "s"} still warm.
            </p>
          )}

          {fire.activeGathering ? (
            <p className="muted">
              Gathering: {fire.activeGathering.title} ·{" "}
              {fire.activeGathering.handCount} hand
              {fire.activeGathering.handCount === 1 ? "" : "s"} raised ·{" "}
              <Link
                href={`/desk/gatherings/${fire.activeGathering.id}`}
                className="btn-text"
              >
                [ open ]
              </Link>
            </p>
          ) : (
            <p className="muted">No Gathering is active.</p>
          )}

          <p>
            <Link href="/desk/gatherings" className="btn-text">
              [ OPEN GATHERINGS ]
            </Link>
          </p>

          <p className="desk-divider" aria-hidden>
            ────────────────────
          </p>

          <h3 className="desk-overview__group-title">WAITING BY THE FIRE</h3>
          <MemberTable
            members={waiting}
            empty="No one is sitting."
          />

          <p className="desk-divider" aria-hidden>
            ────────────────────
          </p>

          <h3 className="desk-overview__group-title">MARKS STILL WARM</h3>
          <MemberTable
            members={warm}
            empty="No warm marks without a seat."
          />
        </>
      ) : null}
    </section>
  );
}
