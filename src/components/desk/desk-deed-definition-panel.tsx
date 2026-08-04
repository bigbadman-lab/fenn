"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  DeskDeedDefinitionForm,
  buildCreatePayload,
  emptyDeedFormValues,
  formValuesFromDefinition,
  shouldExpandAdvancedInitially,
  validateForPublish,
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

function keeperStatusLabel(status: string | undefined): string {
  if (!status || status === "draft") return "Draft";
  if (status === "active") return "Open to Outlaws";
  if (status === "closed") return "Not accepting submissions";
  if (status === "archived") return "Archived";
  return status;
}

export function DeskDeedDefinitionPanel({ deedId }: Props) {
  const { getAuthHeaders } = useDeskGate();
  const router = useRouter();
  const [deed, setDeed] = useState<DeskDeedDefinition | null>(null);
  const [values, setValues] = useState<DeedFormValues>(emptyDeedFormValues());
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [preferAdvancedOpen, setPreferAdvancedOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const isNew = !deedId;
  const readOnly = Boolean(deed && deed.status !== "draft");

  const load = useCallback(async () => {
    if (!deedId) return;
    setError(null);
    setErrorField(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setError("Could not open this Deed.");
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
    const next = formValuesFromDefinition(data.deed);
    setValues(next);
    setPreferAdvancedOpen(shouldExpandAdvancedInitially(next));
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

  function authFailureMessage(httpStatus: number): string {
    if (httpStatus === 401) return "Sign in required.";
    if (httpStatus === 403) return "Desk access denied.";
    if (httpStatus === 404) return "Not found.";
    return "Request failed.";
  }

  function humanizeAuthoringError(
    code: string | undefined,
    fallback: string | undefined,
    httpStatus: number,
  ): string {
    if (code === "slug_conflict") {
      return "That page path is already in use. Change it in Advanced.";
    }
    if (code === "not_editable") {
      return "This Deed can no longer be edited.";
    }
    if (code === "invalid_transition") {
      return fallback ?? "State changed. Refresh and try again.";
    }
    if (code === "invalid_field" || code === "invalid_evidence_requirements") {
      return fallback ?? "Some required details are missing or invalid.";
    }
    if (code === "invalid_reward") {
      return fallback ?? "The LEAF reward is not valid.";
    }
    if (code === "invalid_date_window") {
      return fallback ?? "Start and end times are not valid.";
    }
    return fallback ?? authFailureMessage(httpStatus);
  }

  function focusActions() {
    actionsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /**
   * Persist draft. Returns new/existing id on success.
   * For creates, does not redirect when `deferRedirect` is set (publish path).
   */
  async function saveDraft(options?: {
    manageBusy?: boolean;
    deferRedirect?: boolean;
  }): Promise<{ ok: true; id: string } | { ok: false }> {
    const manageBusy = options?.manageBusy !== false;
    if (manageBusy) setBusy(true);
    setError(null);
    setErrorField(null);
    setStatus(null);
    try {
      const payload = buildCreatePayload(values);
      if (!payload.ok) {
        setError(payload.error);
        setErrorField(payload.field ?? null);
        focusActions();
        return { ok: false };
      }
      const headers = await getAuthHeaders();
      if (!headers) {
        setError("Could not open Desk session.");
        return { ok: false };
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
          return { ok: false };
        }
        const data = await readJsonSafe<{
          ok?: boolean;
          deed?: DeskDeedDefinition;
          error?: string;
          code?: string;
        }>(response);
        if (!response.ok || !data?.deed) {
          setError(
            humanizeAuthoringError(
              data?.code,
              data?.error,
              response.status,
            ),
          );
          if (data?.code === "slug_conflict") setErrorField("slug");
          focusActions();
          return { ok: false };
        }
        setStatus("Draft saved.");
        setDeed(data.deed);
        setValues(formValuesFromDefinition(data.deed));
        if (!options?.deferRedirect) {
          router.push(`/desk/deeds/definitions/${data.deed.id}`);
        }
        return { ok: true, id: data.deed.id };
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
        return { ok: false };
      }
      const data = await readJsonSafe<{
        ok?: boolean;
        deed?: DeskDeedDefinition;
        error?: string;
        code?: string;
      }>(response);
      if (!response.ok || !data?.deed) {
        setError(
          humanizeAuthoringError(data?.code, data?.error, response.status),
        );
        if (data?.code === "slug_conflict") setErrorField("slug");
        focusActions();
        return { ok: false };
      }
      setDeed(data.deed);
      setValues(formValuesFromDefinition(data.deed));
      setStatus("Changes saved.");
      return { ok: true, id: data.deed.id };
    } finally {
      if (manageBusy) setBusy(false);
    }
  }

  async function publish() {
    const client = validateForPublish(values);
    if (!client.ok) {
      setError(client.error);
      setErrorField(client.field ?? null);
      setConfirmPublish(false);
      focusActions();
      return;
    }
    setBusy(true);
    setError(null);
    setErrorField(null);
    setStatus(null);
    try {
      const saved = await saveDraft({ manageBusy: false, deferRedirect: true });
      if (!saved.ok) return;
      const headers = await getAuthHeaders();
      if (!headers) {
        setError("Could not open Desk session.");
        return;
      }
      let response: Response;
      try {
        response = await fetch(`/api/desk/deeds/${saved.id}/publish`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true }),
        });
      } catch {
        setError("Network failure while publishing.");
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
          humanizeAuthoringError(data?.code, data?.error, response.status),
        );
        setConfirmPublish(false);
        focusActions();
        // If we created a new draft, land on the edit page.
        if (isNew) {
          router.push(`/desk/deeds/definitions/${saved.id}`);
        }
        return;
      }
      setConfirmPublish(false);
      setDeed(data.deed);
      setValues(formValuesFromDefinition(data.deed));
      setStatus("Published. Outlaws can take this Deed.");
      if (isNew || deedId !== data.deed.id) {
        router.push(`/desk/deeds/definitions/${data.deed.id}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function lifecycle(
    path: "close" | "archive" | "duplicate",
    okMessage: string,
  ) {
    if (!deedId && path !== "duplicate") return;
    setBusy(true);
    setError(null);
    setErrorField(null);
    setStatus(null);
    try {
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
        setError(
          path === "close"
            ? "Network failure while stopping submissions."
            : path === "archive"
              ? "Network failure while archiving."
              : "Network failure while duplicating.",
        );
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
          humanizeAuthoringError(data?.code, data?.error, response.status),
        );
        return;
      }
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
    let maxCompletions: number | null = null;
    if (values.capMode === "first10") {
      maxCompletions = 10;
    } else if (values.capMode === "custom") {
      const maxParsed = parseOptionalMaxCompletions(values.maxCompletions);
      maxCompletions = maxParsed.ok ? maxParsed.value : null;
    }
    const instructions = values.instructions;
    const lore =
      values.loreDescription.trim() ||
      instructions.trim() ||
      "Description appears here.";
    return {
      id: deed?.id ?? "preview",
      title: values.title.trim() || "Untitled Deed",
      loreDescription: lore,
      instructions:
        instructions.trim() || "Instructions appear here.",
      status: deed?.status ?? "draft",
      slug: values.slug.trim() || null,
      category: values.category.trim() || null,
      accessScope: values.accessScope,
      reward,
      evidenceRequirements: values.evidence,
      evidenceRequirementsInvalid: false,
      startsAt: localDatetimeToIso(values.startsAtLocal),
      endsAt: localDatetimeToIso(values.endsAtLocal),
      maxCompletions,
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

  const previewDeed =
    !deed || deed.status === "draft" ? previewFromForm() : deed;

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

  const canEdit = !readOnly;
  const canPublish = canEdit && (isNew || deed?.status === "draft");

  return (
    <section className="desk-deed-write" aria-label="Write a Deed">
      <p className="desk-deed-write__nav">
        <Link href="/desk/deeds?view=definitions" className="btn-text">
          [ back ]
        </Link>
        {deedId ? (
          <button type="button" className="btn-text" onClick={() => void load()}>
            [ refresh ]
          </button>
        ) : null}
      </p>

      <header className="desk-deed-write__header">
        <h2 className="desk-section-title">
          {isNew ? "WRITE A DEED" : deed?.title ?? "DEED"}
        </h2>
        <p className="muted">{keeperStatusLabel(deed?.status)}</p>
        {readOnly ? (
          <p className="desk-deed-write__readonly-note">
            This Deed is live or closed. Details below are for inspection.
            You can duplicate it, stop accepting submissions, or archive it.
          </p>
        ) : null}
      </header>

      {status ? (
        <p className="desk-deed-write__status" role="status">
          {status}
        </p>
      ) : null}
      {error ? (
        <p className="desk-deed-write__error" role="alert">
          {error}
        </p>
      ) : null}

      {deed && deed.status === "active" ? (
        <ul className="desk-member__facts desk-deed-write__facts">
          <li>Open to Outlaws</li>
          <li>
            {deed.completionsCount} completed
            {deed.maxCompletions != null
              ? ` · first ${deed.maxCompletions}`
              : " · unlimited"}
          </li>
          <li>{formatDeedReward(deed.reward)}</li>
          <li>
            Released:{" "}
            {deed.publishedAt ? deed.publishedAt.slice(0, 10) : "—"}
          </li>
        </ul>
      ) : null}

      <div className="desk-deed-write__layout">
        <div className="desk-deed-write__author">
          <DeskDeedDefinitionForm
            values={values}
            onChange={setValues}
            readOnly={readOnly}
            autoSlug={isNew}
            preferAdvancedOpen={preferAdvancedOpen}
            fieldError={errorField ? error : null}
            errorField={errorField}
          />

          <div
            className="desk-deed-write__actions"
            ref={actionsRef}
          >
            {canEdit ? (
              <button
                type="button"
                className="desk-deed-write__btn"
                disabled={busy}
                onClick={() => void saveDraft()}
              >
                Save Draft
              </button>
            ) : null}

            {canPublish ? (
              !confirmPublish ? (
                <button
                  type="button"
                  className="desk-deed-write__btn desk-deed-write__btn--primary"
                  disabled={busy}
                  onClick={() => setConfirmPublish(true)}
                >
                  Publish
                </button>
              ) : (
                <div className="desk-gatherings__confirm">
                  <p>Publish this Deed?</p>
                  <p className="muted">
                    It will appear on the board when listed. Pending proof will
                    be open for review after Outlaws submit.
                  </p>
                  <button
                    type="button"
                    className="desk-deed-write__btn desk-deed-write__btn--primary"
                    disabled={busy}
                    onClick={() => void publish()}
                  >
                    Confirm publish
                  </button>
                  <button
                    type="button"
                    className="desk-deed-write__btn"
                    onClick={() => setConfirmPublish(false)}
                  >
                    Cancel
                  </button>
                </div>
              )
            ) : null}

            {deed?.status === "draft" && deedId ? (
              !confirmDelete ? (
                <button
                  type="button"
                  className="desk-deed-write__btn"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete draft
                </button>
              ) : (
                <div className="desk-gatherings__confirm">
                  <p>Delete this draft?</p>
                  <button
                    type="button"
                    className="desk-deed-write__btn"
                    disabled={busy}
                    onClick={() => void deleteDraft()}
                  >
                    Confirm delete
                  </button>
                  <button
                    type="button"
                    className="desk-deed-write__btn"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </button>
                </div>
              )
            ) : null}

            {deed?.status === "active" ? (
              !confirmClose ? (
                <button
                  type="button"
                  className="desk-deed-write__btn"
                  disabled={busy}
                  onClick={() => setConfirmClose(true)}
                >
                  Stop accepting submissions
                </button>
              ) : (
                <div className="desk-gatherings__confirm">
                  <p>Stop accepting submissions?</p>
                  <p className="muted">
                    No new proof. Pending review may still finish.
                  </p>
                  <button
                    type="button"
                    className="desk-deed-write__btn"
                    disabled={busy}
                    onClick={() =>
                      void lifecycle(
                        "close",
                        "No longer accepting submissions.",
                      )
                    }
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    className="desk-deed-write__btn"
                    onClick={() => setConfirmClose(false)}
                  >
                    Cancel
                  </button>
                </div>
              )
            ) : null}

            {deed?.status === "closed" ? (
              !confirmArchive ? (
                <button
                  type="button"
                  className="desk-deed-write__btn"
                  disabled={busy}
                  onClick={() => setConfirmArchive(true)}
                >
                  Archive
                </button>
              ) : (
                <div className="desk-gatherings__confirm">
                  <p>Archive this Deed?</p>
                  <button
                    type="button"
                    className="desk-deed-write__btn"
                    disabled={busy}
                    onClick={() =>
                      void lifecycle("archive", "Archived.")
                    }
                  >
                    Confirm archive
                  </button>
                  <button
                    type="button"
                    className="desk-deed-write__btn"
                    onClick={() => setConfirmArchive(false)}
                  >
                    Cancel
                  </button>
                </div>
              )
            ) : null}

            {deedId ? (
              <button
                type="button"
                className="desk-deed-write__btn"
                disabled={busy}
                onClick={() =>
                  void lifecycle("duplicate", "Copy drafted.")
                }
              >
                Duplicate
              </button>
            ) : null}

            {deed?.status === "active" && deed.slug ? (
              <Link href={`/deeds/${deed.slug}`} className="desk-deed-write__btn">
                Open public page
              </Link>
            ) : null}
          </div>
        </div>

        <aside className="desk-deed-write__preview-col" aria-label="Preview">
          <h3 className="desk-deed-write__preview-title">
            HOW OUTLAWS WILL SEE IT
          </h3>
          <DeskDeedPreview
            deed={previewDeed}
            draftLabel={!deed || deed.status === "draft"}
          />
        </aside>
      </div>
    </section>
  );
}
