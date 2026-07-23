"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { formatDeedBoardDate } from "@/lib/deeds/format";
import { deedSubmissionErrorCopy } from "@/lib/deeds/submission-errors";
import type {
  DeedAccessScope,
  DeedEvidenceRequirements,
  SafeDeedSubmission,
} from "@/lib/deeds/types";

type DeedSubmissionPanelProps = {
  deedId: string;
  evidenceRequirements: DeedEvidenceRequirements;
  evidenceRequirementsInvalid: boolean;
  isRepeatable: boolean;
  isOpenForSubmission: boolean;
  accessScope: DeedAccessScope;
};

type MeResponse = {
  ok?: boolean;
  submissions?: SafeDeedSubmission[];
  code?: string;
  error?: string;
};

type CreateResponse = {
  ok?: boolean;
  submission?: SafeDeedSubmission;
  code?: string;
  error?: string;
};

function evidenceSnippet(submission: SafeDeedSubmission): string {
  const parts: string[] = [];
  if (submission.evidenceText) parts.push("text");
  if (submission.evidenceUrl) parts.push("url");
  if (submission.evidenceOther) parts.push("other");
  if (submission.hasImageEvidence) parts.push("image");
  return parts.length > 0 ? parts.join(" + ") : "—";
}

export function DeedSubmissionPanel({
  deedId,
  evidenceRequirements,
  evidenceRequirementsInvalid,
  isRepeatable,
  isOpenForSubmission,
  accessScope,
}: DeedSubmissionPanelProps) {
  const {
    privyReady,
    loading,
    authenticated,
    registered,
    login,
    getAuthHeaders,
  } = useFennAuth();

  const [loadedSubmissions, setLoadedSubmissions] = useState<
    SafeDeedSubmission[] | null
  >(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [other, setOther] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const historyEnabled = authenticated && registered;
  const submissions = historyEnabled ? loadedSubmissions : null;

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) {
        setLoadedSubmissions([]);
        setHistoryError(deedSubmissionErrorCopy("unauthorized"));
        return;
      }
      const response = await fetch(`/api/deeds/${deedId}/submissions/me`, {
        method: "GET",
        headers,
        cache: "no-store",
      });
      const data = (await response.json()) as MeResponse;
      if (!response.ok) {
        setLoadedSubmissions([]);
        setHistoryError(
          deedSubmissionErrorCopy(data.code ?? "internal_error"),
        );
        return;
      }
      setLoadedSubmissions(data.submissions ?? []);
    } catch {
      setLoadedSubmissions([]);
      setHistoryError(deedSubmissionErrorCopy("internal_error"));
    } finally {
      setHistoryLoading(false);
    }
  }, [deedId, getAuthHeaders]);

  useEffect(() => {
    if (!privyReady || loading || !historyEnabled) return;
    const timer = window.setTimeout(() => {
      void loadHistory();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [privyReady, loading, historyEnabled, loadHistory]);

  const pending = useMemo(
    () => submissions?.find((s) => s.status === "pending") ?? null,
    [submissions],
  );
  const latestApproved = useMemo(
    () => submissions?.find((s) => s.status === "approved") ?? null,
    [submissions],
  );
  const latestRejected = useMemo(
    () =>
      !pending
        ? (submissions?.find((s) => s.status === "rejected") ?? null)
        : null,
    [submissions, pending],
  );

  const canShowForm =
    registered &&
    authenticated &&
    isOpenForSubmission &&
    accessScope === "road" &&
    !evidenceRequirementsInvalid &&
    !pending &&
    !(!isRepeatable && latestApproved);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !canShowForm) return;

    setSubmitting(true);
    setFormError(null);

    try {
      const headers = await getAuthHeaders();
      if (!headers) {
        setFormError(deedSubmissionErrorCopy("unauthorized"));
        return;
      }

      let imageRef: string | null = null;
      if (evidenceRequirements.image.allowed) {
        if (evidenceRequirements.image.required && !imageFile) {
          setFormError(deedSubmissionErrorCopy("invalid_evidence"));
          return;
        }
        if (imageFile) {
          const formData = new FormData();
          formData.append("file", imageFile);
          const uploadResponse = await fetch(
            `/api/deeds/${deedId}/evidence/image`,
            {
              method: "POST",
              headers,
              body: formData,
            },
          );
          const uploadData = (await uploadResponse.json()) as {
            ok?: boolean;
            imageRef?: string;
            code?: string;
          };
          if (!uploadResponse.ok || !uploadData.imageRef) {
            setFormError(
              deedSubmissionErrorCopy(uploadData.code ?? "internal_error"),
            );
            return;
          }
          imageRef = uploadData.imageRef;
        }
      }

      const response = await fetch(`/api/deeds/${deedId}/submissions`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          evidenceText: text,
          evidenceUrl: url,
          evidenceOther: other,
          imageRef,
        }),
      });

      const data = (await response.json()) as CreateResponse;
      if (!response.ok || !data.submission) {
        setFormError(deedSubmissionErrorCopy(data.code ?? "internal_error"));
        return;
      }

      setText("");
      setUrl("");
      setOther("");
      setImageFile(null);
      setLoadedSubmissions((prev) => {
        const next = prev ? [...prev] : [];
        return [
          data.submission!,
          ...next.filter((s) => s.id !== data.submission!.id),
        ];
      });
    } catch {
      setFormError(deedSubmissionErrorCopy("internal_error"));
    } finally {
      setSubmitting(false);
    }
  }

  if (!privyReady || loading) {
    return (
      <section className="deed-proof" aria-live="polite">
        <p className="muted">...</p>
      </section>
    );
  }

  if (!authenticated) {
    return (
      <section className="deed-proof" aria-labelledby="deed-proof-title">
        <h2 id="deed-proof-title" className="deed-proof__title">
          PROOF
        </h2>
        <p>ENTRY IS REQUIRED BEFORE WORK CAN BE GIVEN.</p>
        <p>
          <button type="button" className="btn-text" onClick={() => login()}>
            [ enter ]
          </button>
        </p>
      </section>
    );
  }

  if (!registered) {
    return (
      <section className="deed-proof" aria-labelledby="deed-proof-title">
        <h2 id="deed-proof-title" className="deed-proof__title">
          PROOF
        </h2>
        <p>A NAME MUST BE ENTERED IN THE BOOK FIRST.</p>
        <p>
          <Link href="/#outlaw-register" className="btn-text">
            [ register ]
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section className="deed-proof" aria-labelledby="deed-proof-title">
      <h2 id="deed-proof-title" className="deed-proof__title">
        PROOF
      </h2>

      {historyLoading && !submissions ? (
        <p className="muted">...</p>
      ) : null}

      {historyError && historyEnabled ? (
        <p className="deed-proof__error">{historyError}</p>
      ) : null}

      {accessScope === "greenwood" ? (
        <p>this work begins beyond the gate.</p>
      ) : null}

      {accessScope === "common" ? (
        <p>this work is not yet open on the road.</p>
      ) : null}

      {accessScope === "road" && evidenceRequirementsInvalid ? (
        <p>this notice cannot take proof yet.</p>
      ) : null}

      {accessScope === "road" && !isOpenForSubmission ? (
        <p>this work is no longer being taken.</p>
      ) : null}

      {pending ? (
        <div className="deed-proof__state">
          <p>PROOF LEFT.</p>
          <p className="muted">awaiting judgement.</p>
          {formatDeedBoardDate(pending.submittedAt) ? (
            <p className="muted">
              {formatDeedBoardDate(pending.submittedAt)} ·{" "}
              {evidenceSnippet(pending)}
            </p>
          ) : null}
          {pending.hasImageEvidence ? (
            <p className="muted">IMAGE · proof attached.</p>
          ) : null}
        </div>
      ) : null}

      {!pending && latestApproved && !isRepeatable ? (
        <div className="deed-proof__state">
          <p>DEED COMPLETE.</p>
          <p className="muted">the board remembers.</p>
          {latestApproved.leafAwarded != null &&
          latestApproved.leafAwarded > 0 ? (
            <p>+{latestApproved.leafAwarded} LEAF</p>
          ) : null}
          {latestApproved.hasImageEvidence ? (
            <p className="muted">IMAGE · proof attached.</p>
          ) : null}
        </div>
      ) : null}

      {!pending &&
      latestRejected &&
      !(latestApproved && !isRepeatable) ? (
        <div className="deed-proof__state deed-proof__state--rejected">
          <p>returned.</p>
          {latestRejected.reviewNote ? (
            <div className="deed-proof__note">
              <p className="deed-proof__note-label">FROM THE BOARD</p>
              <p>{latestRejected.reviewNote}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {canShowForm ? (
        <form className="deed-proof-form" onSubmit={onSubmit} noValidate>
          {evidenceRequirements.text.allowed ? (
            <label className="deed-proof-field">
              <span className="deed-proof-field__label">
                TEXT /{" "}
                {evidenceRequirements.text.required ? "REQUIRED" : "OPTIONAL"}
              </span>
              <textarea
                className="deed-proof-field__control"
                name="evidenceText"
                rows={5}
                value={text}
                onChange={(e) => setText(e.target.value)}
                required={evidenceRequirements.text.required}
                disabled={submitting}
              />
            </label>
          ) : null}

          {evidenceRequirements.url.allowed ? (
            <label className="deed-proof-field">
              <span className="deed-proof-field__label">
                URL /{" "}
                {evidenceRequirements.url.required ? "REQUIRED" : "OPTIONAL"}
              </span>
              <input
                className="deed-proof-field__control"
                type="url"
                name="evidenceUrl"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required={evidenceRequirements.url.required}
                disabled={submitting}
                placeholder="https://"
                autoComplete="off"
              />
            </label>
          ) : null}

          {evidenceRequirements.other.allowed ? (
            <label className="deed-proof-field">
              <span className="deed-proof-field__label">
                OTHER /{" "}
                {evidenceRequirements.other.required ? "REQUIRED" : "OPTIONAL"}
              </span>
              <textarea
                className="deed-proof-field__control"
                name="evidenceOther"
                rows={3}
                value={other}
                onChange={(e) => setOther(e.target.value)}
                required={evidenceRequirements.other.required}
                disabled={submitting}
              />
            </label>
          ) : null}

          {evidenceRequirements.image.allowed ? (
            <label className="deed-proof-field">
              <span className="deed-proof-field__label">
                IMAGE /{" "}
                {evidenceRequirements.image.required ? "REQUIRED" : "OPTIONAL"}
              </span>
              <input
                className="deed-proof-field__control"
                type="file"
                name="evidenceImage"
                accept="image/jpeg,image/png,image/webp"
                disabled={submitting}
                required={evidenceRequirements.image.required}
                onChange={(e) => {
                  const next = e.target.files?.[0] ?? null;
                  setImageFile(next);
                }}
              />
              <span className="muted deed-proof-form__aside">
                jpg / png / webp · 5mb max
                {imageFile ? ` · ${imageFile.name}` : ""}
              </span>
            </label>
          ) : null}

          {formError ? <p className="deed-proof__error">{formError}</p> : null}

          <p className="deed-proof-form__actions">
            <button
              type="submit"
              className="btn-text"
              disabled={submitting}
              aria-busy={submitting || undefined}
            >
              {submitting ? "[ waiting ]" : "[ leave proof ]"}
            </button>
          </p>
        </form>
      ) : null}

      {submissions && submissions.length > 0 ? (
        <div className="deed-marks" aria-labelledby="deed-marks-title">
          <h3 id="deed-marks-title" className="deed-marks__title">
            YOUR MARKS
          </h3>
          <ul className="deed-marks__list">
            {submissions.map((mark) => (
              <li key={mark.id}>
                <span className="deed-marks__date">
                  {formatDeedBoardDate(mark.submittedAt) ?? "—"}
                </span>
                <span className="deed-marks__status">
                  {mark.status.toUpperCase()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
