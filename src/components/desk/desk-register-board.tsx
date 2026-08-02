"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useDeskGate } from "@/components/desk/desk-gate";
import type {
  DeskPresenceState,
  DeskRegisterListPage,
  DeskRegisterMemberListItem,
} from "@/lib/desk/register-types";

function presenceLabel(state: DeskPresenceState): string {
  switch (state) {
    case "at_the_fire":
      return "AT THE FIRE";
    case "sitting":
      return "SITTING";
    case "recently_warm":
      return "RECENTLY WARM";
    default:
      return "—";
  }
}

function formatJoined(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function DeskRegisterBoard() {
  const { getAuthHeaders } = useDeskGate();
  const [q, setQ] = useState("");
  const [greenwood, setGreenwood] = useState("all");
  const [presence, setPresence] = useState("all");
  const [pendingDeeds, setPendingDeeds] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DeskRegisterListPage | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(false);
      setLoading(true);
      const headers = await getAuthHeaders();
      if (signal?.aborted) return;
      if (!headers) {
        setData(null);
        setError(true);
        setLoading(false);
        return;
      }
      const params = new URLSearchParams({
        page: String(page),
        limit: "25",
        greenwood,
        presence,
        pendingDeeds,
      });
      if (q.trim()) params.set("q", q.trim());

      try {
        const response = await fetch(`/api/desk/register?${params}`, {
          headers,
          cache: "no-store",
          signal,
        });
        if (signal?.aborted) return;
        if (!response.ok) {
          setData(null);
          setError(true);
          setLoading(false);
          return;
        }
        const json = (await response.json()) as DeskRegisterListPage & {
          ok?: boolean;
        };
        if (signal?.aborted) return;
        setData({
          members: json.members ?? [],
          page: json.page,
          limit: json.limit,
          total: json.total,
          hasMore: json.hasMore,
        });
        setLoading(false);
      } catch (error) {
        if (signal?.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setData(null);
        setError(true);
        setLoading(false);
      }
    },
    [getAuthHeaders, page, greenwood, presence, pendingDeeds, q]
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void load(controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  async function onCopy(member: DeskRegisterMemberListItem) {
    const ok = await copyText(member.walletAddress);
    if (ok) {
      setCopiedId(member.profileId);
      window.setTimeout(() => setCopiedId(null), 1600);
    }
  }

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.limit))
    : 1;

  return (
    <section className="desk-register" aria-label="The Register">
      <h2 className="desk-section-title">THE REGISTER</h2>
      <p className="muted">
        Profiles and their linked wallets. Copy one wallet at a time.
      </p>

      <form
        className="desk-register__filters"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          void load();
        }}
      >
        <label className="desk-register__field">
          <span className="muted">Search</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="name · number · wallet · x"
            autoComplete="off"
          />
        </label>
        <label className="desk-register__field">
          <span className="muted">Greenwood</span>
          <select
            value={greenwood}
            onChange={(e) => {
              setGreenwood(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">all</option>
            <option value="member">members</option>
            <option value="non_member">non-members</option>
          </select>
        </label>
        <label className="desk-register__field">
          <span className="muted">Fire</span>
          <select
            value={presence}
            onChange={(e) => {
              setPresence(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">all</option>
            <option value="at_fire">at the fire</option>
            <option value="not_present">not present</option>
          </select>
        </label>
        <label className="desk-register__field">
          <span className="muted">Deeds</span>
          <select
            value={pendingDeeds}
            onChange={(e) => {
              setPendingDeeds(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">all</option>
            <option value="pending">pending review</option>
          </select>
        </label>
        <button type="submit" className="btn-text">
          [ seek ]
        </button>
      </form>

      <p className="desk-divider" aria-hidden>
        ────────────────────
      </p>

      {loading && !data ? <p className="muted">…</p> : null}
      {error ? <p className="muted">The Register could not be opened.</p> : null}
      {data && data.members.length === 0 ? (
        <p className="muted">No profiles match.</p>
      ) : null}

      {data && data.members.length > 0 ? (
        <div className="desk-register__table-wrap">
          <table className="desk-register__table">
            <thead>
              <tr>
                <th>MARK</th>
                <th>OUTLAW</th>
                <th>WALLET</th>
                <th>LEAF</th>
                <th>LIFETIME</th>
                <th>STANDING</th>
                <th>GREENWOOD</th>
                <th>FIRE</th>
                <th>X</th>
                <th>JOINED</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((member) => (
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
                    <Link
                      href={`/desk/register/${member.profileId}`}
                      className="desk-register__name"
                    >
                      {member.displayName}
                    </Link>
                    <div className="muted">#{member.outlawNumberLabel}</div>
                    {member.pendingDeedCount > 0 ? (
                      <div className="muted">
                        {member.pendingDeedCount} pending deed
                        {member.pendingDeedCount === 1 ? "" : "s"}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <code title={member.walletAddress}>{member.walletShort}</code>
                    <div className="desk-register__wallet-actions">
                      <button
                        type="button"
                        className="btn-text"
                        onClick={() => void onCopy(member)}
                      >
                        {copiedId === member.profileId
                          ? "[ COPIED ]"
                          : "[ COPY WALLET ]"}
                      </button>
                      {member.explorerUrl ? (
                        <a
                          href={member.explorerUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="btn-text"
                        >
                          [ RH CHAIN ]
                        </a>
                      ) : null}
                    </div>
                  </td>
                  <td>{member.leafBalance}</td>
                  <td>{member.leafLifetimeEarned}</td>
                  <td>{member.standingLabel}</td>
                  <td>{member.greenwoodMember ? "yes" : "no"}</td>
                  <td>{presenceLabel(member.presence)}</td>
                  <td>{member.xHandle ? `@${member.xHandle}` : "—"}</td>
                  <td>{formatJoined(member.joinedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {data ? (
        <div className="desk-register__pager">
          <span className="muted">
            page {data.page} / {totalPages} · {data.total} profiles
          </span>
          <div>
            <button
              type="button"
              className="btn-text"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              [ prev ]
            </button>
            <button
              type="button"
              className="btn-text"
              disabled={!data.hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              [ next ]
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
