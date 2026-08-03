"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  DeskDeedDefinitionForm,
  buildCreatePayload,
  emptyDeedFormValues,
  formValuesFromDefinition,
  type DeedFormValues,
} from "@/components/desk/desk-deed-definition-form";
import { DeskDeedPreview } from "@/components/desk/desk-deed-preview";
import { useDeskGate } from "@/components/desk/desk-gate";
import type { DeskDeedDefinition } from "@/lib/desk/deed-definition-types";
import {
  localDatetimeToIso,
  parseOptionalMaxCompletions,
} from "@/lib/desk/deed-form-map";
import { formatDeedReward } from "@/lib/deeds/format";

type Props = {
  /** omit for create mode */
  deedId?: string;
};

export function DeskDeedDefinitionPanel({ deedId }: Props) {
  const { getAuthHeaders } = useDeskGate();
  const router = useRouter();
  const [deed, setDeed] = useState<DeskDeedDefinition | null>(null);
  const [values, setValues] = useState<DeedFormValues>(emptyDeedFormValues());
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isNew = !deedId;
  const readOnly = Boolean(deed && deed.status !== "draft");

  const load = useCallback(async () => {
    if (!deedId) return;
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setError("Could not open Deed.");
      return;
    }
    const response = await fetch(`/api/desk/deeds/${deedId}`, {
      headers,
      cache: "no-store",
    });
    const data = (await response.json()) as {
      ok?: boolean;
      deed?: DeskDeedDefinition;
      error?: string;
    };
    if (!response.ok || !data.deed) {
      setError(data.error ?? "Deed not found.");
      setDeed(null);
      return;
    }
    setDeed(data.deed);
    setValues(formValuesFromDefinition(data.deed));
  }, [deedId, getAuthHeaders]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function readJsonSafe<T>(response: Response): Promise<T | null> {
    try {
      return (await response.json()) as T;
    } catch {
      return null;
    }
  }

  function authFailureMessage(status: number): string {
    if (status === 401) return "Sign in required.";
    if (status === 403) return "Desk access denied.";
    if (status === 404) return "Not found.";
    return "Request failed.";
  }

  async function saveDraft(options?: { manageBusy?: boolean }): Promise<boolean> {
    const manageBusy = options?.manageBusy !== false;
    if (manageBusy) setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const payload = buildCreatePayload(values);
      if (!payload.ok) {
        setError(payload.error);
        return false;
      }
      const headers = await getAuthHeaders();
      if (!headers) {
        setError("Could not open Desk session.");
        return false;
      }

      if (isNew) {
        let response: Response;
        try {
          response = await fetch("/api/desk/deeds", {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify(payload.body),
          });
        } catch {
          setError("Network failure while saving draft.");
          return false;
        }
        const data = await readJsonSafe<{
          ok?: boolean;
          deed?: DeskDeedDefinition;
          error?: string;
          code?: string;
        }>(response);
        if (!response.ok || !data?.deed) {
          setError(
            data?.code === "slug_conflict"
              ? "Slug already exists."
              : (data?.error ??
                  authFailureMessage(response.status) ??
                  "Could not save draft."),
          );
          return false;
        }
        setStatus("Draft saved.");
        router.push(`/desk/deeds/definitions/${data.deed.id}`);
        return true;
      }

      let response: Response;
      try {
        response = await fetch(`/api/desk/deeds/${deedId}`, {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(payload.body),
        });
      } catch {
        setError("Network failure while saving changes.");
        return false;
      }
      const data = await readJsonSafe<{
        ok?: boolean;
        deed?: DeskDeedDefinition;
        error?: string;
        code?: string;
      }>(response);
      if (!response.ok || !data?.deed) {
        setError(
          data?.code === "slug_conflict"
            ? "Slug already exists."
            : data?.code === "not_editable"
              ? "This Deed can no longer be edited."
              : (data?.error ?? authFailureMessage(response.status)),
        );
        return false;
      }
      setDeed(data.deed);
      setValues(formValuesFromDefinition(data.deed));
      setStatus("Changes saved.");
      return true;
    } finally {
      if (manageBusy) setBusy(false);
    }
  }

  async function lifecycle(
    path: "publish" | "close" | "archive" | "duplicate",
    okMessage: string,
  ) {
    if (!deedId && path !== "duplicate") return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      if (path === "publish") {
        // Keep busy through save + publish so release cannot double-submit.
        const saved = await saveDraft({ manageBusy: false });
        if (!saved) return;
      }
      const headers = await getAuthHeaders();
      if (!headers) {
        setError("Could not open Desk session.");
        return;
      }
      const id = deedId ?? deed?.id;
      if (!id) return;
      let response: Response;
      try {
        response = await fetch(`/api/desk/deeds/${id}/${path}`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body:
            path === "duplicate"
              ? undefined
              : JSON.stringify({ confirm: true }),
        });
      } catch {
        setError(`Network failure during ${path}.`);
        return;
      }
      const data = await readJsonSafe<{
        ok?: boolean;
        deed?: DeskDeedDefinition;
        error?: string;
        code?: string;
      }>(response);
      if (!response.ok || !data?.deed) {
        setError(
          data?.code === "invalid_transition"
            ? (data.error ?? "State changed. Refresh and try again.")
            : (data?.error ?? authFailureMessage(response.status)),
        );
        return;
      }
      setConfirmPublish(false);
      setConfirmClose(false);
      setConfirmArchive(false);
      if (path === "duplicate") {
        setStatus("Copy drafted.");
        router.push(`/desk/deeds/definitions/${data.deed.id}`);
        return;
      }
      setDeed(data.deed);
      setValues(formValuesFromDefinition(data.deed));
      setStatus(okMessage);
    } finally {
      setBusy(false);
    }
  }

  async function deleteDraft() {
    if (!deedId) return;
    setBusy(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) {
        setError("Could not open Desk session.");
        return;
      }
      let response: Response;
      try {
        response = await fetch(`/api/desk/deeds/${deedId}`, {
          method: "DELETE",
          headers,
        });
      } catch {
        setError("Network failure while deleting.");
        return;
      }
      const data = await readJsonSafe<{ error?: string; code?: string }>(
        response,
      );
      if (!response.ok) {
        setError(data?.error ?? authFailureMessage(response.status));
        return;
      }
      router.push("/desk/deeds?view=definitions");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  function previewFromForm(): DeskDeedDefinition {
    const built = buildCreatePayload(values);
    const reward: DeskDeedDefinition["reward"] = built.ok
      ? (built.body.reward as DeskDeedDefinition["reward"])
      : { type: "none" };
    const maxParsed = parseOptionalMaxCompletions(values.maxCompletions);
    return {
      id: deed?.id ?? "preview",
      title: values.title.trim() || "Untitled Deed",
      loreDescription: values.loreDescription,
      instructions: values.instructions,
      status: deed?.status ?? "draft",
      slug: values.slug.trim() || null,
      category: values.category.trim() || null,
      accessScope: values.accessScope,
      reward,
      evidenceRequirements: values.evidence,
      evidenceRequirementsInvalid: false,
      startsAt: localDatetimeToIso(values.startsAtLocal),
      endsAt: localDatetimeToIso(values.endsAtLocal),
      maxCompletions: maxParsed.ok ? maxParsed.value : null,
      completionsCount: deed?.completionsCount ?? 0,
      isRepeatable: values.isRepeatable,
      isPublic: values.isPublic,
      sponsorName: values.sponsorName.trim() || null,
      externalRewardNote: values.externalRewardNote.trim() || null,
      publishedAt: deed?.publishedAt ?? null,
      eligibility: {},
      sponsorContributionId: null,
      commonTargetCount: null,
      commonProgressCount: 0,
      createdAt: deed?.createdAt ?? null,
      updatedAt: deed?.updatedAt ?? null,
    };
  }

  if (deedId && !deed && !error) return <p className="muted">…</p>;
  if (deedId && error && !deed) {
    return (
      <section>
        <p className="muted">{error}</p>
        <Link href="/desk/deeds?view=definitions" className="btn-text">
          [ back ]
        </Link>
      </section>
    );
  }

  const statusLabel = deed?.status?.toUpperCase() ?? "NEW DRAFT";

  return (
    <section className="desk-deed-definition" aria-label="Deed definition">
      <p>
        <Link href="/desk/deeds?view=definitions" className="btn-text">
          [ back to definitions ]
        </Link>
        {deedId ? (
          <button type="button" className="btn-text" onClick={() => void load()}>
            [ refresh ]
          </button>
        ) : null}
      </p>
      <h2 className="desk-section-title">
        {isNew ? "WRITE A DEED" : deed?.title ?? "DEED"}
      </h2>
      <p className="muted">{statusLabel}</p>
      {status ? <p>{status}</p> : null}
      {error ? <p className="muted">{error}</p> : null}

      {deed && deed.status === "active" ? (
        <ul className="desk-member__facts">
          <li>ACTIVE</li>
          <li>
            {deed.completionsCount} completed
            {deed.maxCompletions != null
              ? ` · ${deed.maxCompletions} maximum`
              : ""}
          </li>
          <li>{formatDeedReward(deed.reward)}</li>
          <li>Published: {deed.publishedAt ?? "—"}</li>
        </ul>
      ) : null}

      <DeskDeedDefinitionForm
        values={values}
        onChange={setValues}
        readOnly={readOnly}
        autoSlug={isNew}
      />

      <div className="desk-gatherings__actions">
        {!readOnly ? (
          <button
            type="button"
            className="btn-text"
            disabled={busy}
            onClick={() => void saveDraft()}
          >
            [ {isNew ? "SAVE DRAFT" : "SAVE CHANGES"} ]
          </button>
        ) : null}

        <button
          type="button"
          className="btn-text"
          onClick={() => setShowPreview((v) => !v)}
        >
          [ PREVIEW ]
        </button>

        {deed?.status === "draft" && deedId ? (
          <>
            {!confirmPublish ? (
              <button
                type="button"
                className="btn-text"
                disabled={busy}
                onClick={() => setConfirmPublish(true)}
              >
                [ RELEASE INTO THE WORLD ]
              </button>
            ) : (
              <div className="desk-gatherings__confirm">
                <p>RELEASE INTO THE WORLD</p>
                <p className="muted">
                  Publish this Deed. It will appear on the board when listed.
                </p>
                <button
                  type="button"
                  className="btn-text"
                  disabled={busy}
                  onClick={() => void lifecycle("publish", "THE DEED IS ACTIVE")}
                >
                  [ confirm release ]
                </button>
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => setConfirmPublish(false)}
                >
                  [ cancel ]
                </button>
              </div>
            )}
            {!confirmDelete ? (
              <button
                type="button"
                className="btn-text"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                [ DELETE ]
              </button>
            ) : (
              <div className="desk-gatherings__confirm">
                <p>DELETE DRAFT</p>
                <button
                  type="button"
                  className="btn-text"
                  disabled={busy}
                  onClick={() => void deleteDraft()}
                >
                  [ confirm delete ]
                </button>
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => setConfirmDelete(false)}
                >
                  [ cancel ]
                </button>
              </div>
            )}
          </>
        ) : null}

        {deed?.status === "active" ? (
          !confirmClose ? (
            <button
              type="button"
              className="btn-text"
              disabled={busy}
              onClick={() => setConfirmClose(true)}
            >
              [ CLOSE THE DEED ]
            </button>
          ) : (
            <div className="desk-gatherings__confirm">
              <p>CLOSE THE DEED</p>
              <p className="muted">No new submissions. Pending review may finish.</p>
              <button
                type="button"
                className="btn-text"
                disabled={busy}
                onClick={() => void lifecycle("close", "THE DEED IS CLOSED")}
              >
                [ confirm close ]
              </button>
              <button
                type="button"
                className="btn-text"
                onClick={() => setConfirmClose(false)}
              >
                [ cancel ]
              </button>
            </div>
          )
        ) : null}

        {deed?.status === "closed" ? (
          !confirmArchive ? (
            <button
              type="button"
              className="btn-text"
              disabled={busy}
              onClick={() => setConfirmArchive(true)}
            >
              [ ARCHIVE ]
            </button>
          ) : (
            <div className="desk-gatherings__confirm">
              <p>ARCHIVE</p>
              <button
                type="button"
                className="btn-text"
                disabled={busy}
                onClick={() =>
                  void lifecycle("archive", "THE DEED IS ARCHIVED")
                }
              >
                [ confirm archive ]
              </button>
              <button
                type="button"
                className="btn-text"
                onClick={() => setConfirmArchive(false)}
              >
                [ cancel ]
              </button>
            </div>
          )
        ) : null}

        {deedId ? (
          <button
            type="button"
            className="btn-text"
            disabled={busy}
            onClick={() => void lifecycle("duplicate", "Copy drafted.")}
          >
            [ DUPLICATE ]
          </button>
        ) : null}

        {deed?.status === "active" && deed.slug ? (
          <Link href={`/deeds/${deed.slug}`} className="btn-text">
            [ OPEN PUBLIC PAGE ]
          </Link>
        ) : null}
      </div>

      {showPreview ? (
        <DeskDeedPreview
          deed={
            // Drafts (including unsaved new drafts) preview from Desk form state.
            // Active/closed/archived use the loaded definition DTO.
            !deed || deed.status === "draft" ? previewFromForm() : deed
          }
          draftLabel={!deed || deed.status === "draft"}
        />
      ) : null}
    </section>
  );
}
