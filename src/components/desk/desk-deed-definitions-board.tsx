"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DeskDeedsWorkspaceNav } from "@/components/desk/desk-deeds-workspace-nav";
import { useDeskGate } from "@/components/desk/desk-gate";
import type {
  DeedDefinitionFilter,
  DeskDeedDefinitionListItem,
} from "@/lib/desk/deed-definition-types";
import { formatDeedReward } from "@/lib/deeds/format";

const FILTERS: DeedDefinitionFilter[] = [
  "all",
  "draft",
  "active",
  "closed",
  "archived",
];

export function DeskDeedDefinitionsBoard() {
  const { getAuthHeaders } = useDeskGate();
  const router = useRouter();
  const [filter, setFilter] = useState<DeedDefinitionFilter>("all");
  const [items, setItems] = useState<DeskDeedDefinitionListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    id: string;
    action: "publish" | "close" | "archive" | "delete";
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setItems([]);
      setError("Could not open definitions.");
      return;
    }
    let response: Response;
    try {
      response = await fetch(
        `/api/desk/deeds?filter=${encodeURIComponent(filter)}`,
        { headers, cache: "no-store" },
      );
    } catch {
      setError("Network failure while loading definitions.");
      setItems([]);
      return;
    }
    let data: {
      ok?: boolean;
      deeds?: DeskDeedDefinitionListItem[];
      error?: string;
    } | null = null;
    try {
      data = (await response.json()) as {
        ok?: boolean;
        deeds?: DeskDeedDefinitionListItem[];
        error?: string;
      };
    } catch {
      data = null;
    }
    if (!response.ok || !data?.ok) {
      setError(
        data?.error ??
          (response.status === 401
            ? "Sign in required."
            : response.status === 403
              ? "Desk access denied."
              : "Could not load definitions."),
      );
      setItems([]);
      return;
    }
    setItems(data.deeds ?? []);
  }, [filter, getAuthHeaders]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filtered = useMemo(() => {
    if (!items) return null;
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        (d.slug ?? "").toLowerCase().includes(q),
    );
  }, [items, query]);

  async function act(
    id: string,
    action: "publish" | "close" | "archive" | "delete" | "duplicate",
  ) {
    setBusyId(id);
    setError(null);
    setStatus(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) {
        setError("Could not open Desk session.");
        return;
      }
      const authHeaders = headers;
      async function call(): Promise<Response> {
        if (action === "delete") {
          return fetch(`/api/desk/deeds/${id}`, {
            method: "DELETE",
            headers: authHeaders,
          });
        }
        if (action === "duplicate") {
          return fetch(`/api/desk/deeds/${id}/duplicate`, {
            method: "POST",
            headers: authHeaders,
          });
        }
        return fetch(`/api/desk/deeds/${id}/${action}`, {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true }),
        });
      }
      let response: Response;
      try {
        response = await call();
      } catch {
        setError(`Network failure during ${action}.`);
        return;
      }
      let data: {
        deed?: { id: string };
        error?: string;
      } | null = null;
      try {
        data = (await response.json()) as {
          deed?: { id: string };
          error?: string;
        };
      } catch {
        data = null;
      }
      if (action === "delete") {
        if (!response.ok) {
          setError(data?.error ?? "Delete failed.");
          return;
        }
        setStatus("Draft deleted.");
        setConfirm(null);
        await load();
        return;
      }
      if (action === "duplicate") {
        if (!response.ok || !data?.deed) {
          setError(data?.error ?? "Duplicate failed.");
          return;
        }
        router.push(`/desk/deeds/definitions/${data.deed.id}`);
        return;
      }
      if (!response.ok) {
        setError(data?.error ?? `${action} failed`);
        return;
      }
      setStatus(
        action === "publish"
          ? "THE DEED IS ACTIVE"
          : action === "close"
            ? "THE DEED IS CLOSED"
            : "THE DEED IS ARCHIVED",
      );
      setConfirm(null);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="desk-deeds" aria-label="Deed definitions">
      <DeskDeedsWorkspaceNav activeView="definitions" />
      <div className="desk-hollow__head">
        <button
          type="button"
          className="btn-text"
          onClick={() => router.push("/desk/deeds/definitions/new")}
        >
          [ WRITE A DEED ]
        </button>
        <button type="button" className="btn-text" onClick={() => void load()}>
          [ refresh ]
        </button>
      </div>
      {status ? <p>{status}</p> : null}
      {error ? <p className="muted">{error}</p> : null}

      <div className="desk-register__filters">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={
              filter === f ? "btn-text desk-hollow__filter--active" : "btn-text"
            }
            onClick={() => setFilter(f)}
          >
            [{f}]
          </button>
        ))}
      </div>
      <label className="desk-register__field">
        Search
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="title or slug"
        />
      </label>

      {filtered === null ? (
        <p className="muted">…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No deeds in this filter.</p>
      ) : (
        <ul className="desk-member__list">
          {filtered.map((item) => (
            <li key={item.id}>
              <Link
                href={`/desk/deeds/definitions/${item.id}`}
                className="desk-register__name"
              >
                {item.title}
              </Link>
              {" · "}
              <span className="muted">{item.status.toUpperCase()}</span>
              {item.slug ? ` · ${item.slug}` : ""}
              {" · "}
              {item.accessScope}
              {" · "}
              {formatDeedReward(item.reward)}
              {" · "}
              {item.isPublic ? "listed" : "unlisted"}
              {item.isRepeatable ? " · repeatable" : ""}
              {" · "}
              {item.completionsCount}
              {item.maxCompletions != null ? `/${item.maxCompletions}` : ""}{" "}
              completed
              {item.publishedAt ? ` · pub ${item.publishedAt.slice(0, 10)}` : ""}
              <div className="desk-gatherings__actions">
                {item.status === "draft" ? (
                  <>
                    <Link
                      href={`/desk/deeds/definitions/${item.id}`}
                      className="btn-text"
                    >
                      [ EDIT ]
                    </Link>
                    <button
                      type="button"
                      className="btn-text"
                      disabled={busyId === item.id}
                      onClick={() =>
                        setConfirm({ id: item.id, action: "publish" })
                      }
                    >
                      [ PUBLISH ]
                    </button>
                    <button
                      type="button"
                      className="btn-text"
                      disabled={busyId === item.id}
                      onClick={() => void act(item.id, "duplicate")}
                    >
                      [ DUPLICATE ]
                    </button>
                    <button
                      type="button"
                      className="btn-text"
                      disabled={busyId === item.id}
                      onClick={() =>
                        setConfirm({ id: item.id, action: "delete" })
                      }
                    >
                      [ DELETE ]
                    </button>
                  </>
                ) : null}
                {item.status === "active" ? (
                  <>
                    <Link
                      href={`/desk/deeds/definitions/${item.id}`}
                      className="btn-text"
                    >
                      [ VIEW ]
                    </Link>
                    {item.slug ? (
                      <Link href={`/deeds/${item.slug}`} className="btn-text">
                        [ PREVIEW ]
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      className="btn-text"
                      disabled={busyId === item.id}
                      onClick={() =>
                        setConfirm({ id: item.id, action: "close" })
                      }
                    >
                      [ CLOSE ]
                    </button>
                    <button
                      type="button"
                      className="btn-text"
                      disabled={busyId === item.id}
                      onClick={() => void act(item.id, "duplicate")}
                    >
                      [ DUPLICATE ]
                    </button>
                  </>
                ) : null}
                {item.status === "closed" ? (
                  <>
                    <Link
                      href={`/desk/deeds/definitions/${item.id}`}
                      className="btn-text"
                    >
                      [ VIEW ]
                    </Link>
                    <button
                      type="button"
                      className="btn-text"
                      disabled={busyId === item.id}
                      onClick={() =>
                        setConfirm({ id: item.id, action: "archive" })
                      }
                    >
                      [ ARCHIVE ]
                    </button>
                    <button
                      type="button"
                      className="btn-text"
                      disabled={busyId === item.id}
                      onClick={() => void act(item.id, "duplicate")}
                    >
                      [ DUPLICATE ]
                    </button>
                  </>
                ) : null}
                {item.status === "archived" ? (
                  <>
                    <Link
                      href={`/desk/deeds/definitions/${item.id}`}
                      className="btn-text"
                    >
                      [ VIEW ]
                    </Link>
                    <button
                      type="button"
                      className="btn-text"
                      disabled={busyId === item.id}
                      onClick={() => void act(item.id, "duplicate")}
                    >
                      [ DUPLICATE ]
                    </button>
                  </>
                ) : null}
              </div>
              {confirm?.id === item.id ? (
                <div className="desk-gatherings__confirm">
                  <p>
                    Confirm {confirm.action.toUpperCase()} — {item.title}
                  </p>
                  <button
                    type="button"
                    className="btn-text"
                    disabled={busyId === item.id}
                    onClick={() => void act(item.id, confirm.action)}
                  >
                    [ confirm ]
                  </button>
                  <button
                    type="button"
                    className="btn-text"
                    onClick={() => setConfirm(null)}
                  >
                    [ cancel ]
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
