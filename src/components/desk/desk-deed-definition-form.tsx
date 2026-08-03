"use client";

import { useEffect, useRef } from "react";

import type { DeskDeedDefinition } from "@/lib/desk/deed-definition-types";
import {
  DEFAULT_EVIDENCE_FORM,
  hasAnyAllowedEvidence,
  isoToLocalDatetime,
  localDatetimeToIso,
  parseOptionalMaxCompletions,
  rewardModeFromReward,
  rewardPayloadFromForm,
  setEvidenceAllowed,
  setEvidenceRequired,
  suggestSlugFromTitle,
  type EvidenceFormState,
  type RewardFormMode,
} from "@/lib/desk/deed-form-map";
import type { DeedAccessScope } from "@/lib/deeds/types";

export type DeedFormValues = {
  title: string;
  slug: string;
  category: string;
  loreDescription: string;
  instructions: string;
  accessScope: "road" | "greenwood";
  isPublic: boolean;
  rewardMode: RewardFormMode;
  fixedAmount: string;
  minAmount: string;
  maxAmount: string;
  evidence: EvidenceFormState;
  startsAtLocal: string;
  endsAtLocal: string;
  isRepeatable: boolean;
  maxCompletions: string;
  sponsorName: string;
  externalRewardNote: string;
};

export function emptyDeedFormValues(): DeedFormValues {
  return {
    title: "",
    slug: "",
    category: "",
    loreDescription: "",
    instructions: "",
    accessScope: "road",
    isPublic: true,
    rewardMode: "none",
    fixedAmount: "",
    minAmount: "",
    maxAmount: "",
    evidence: { ...DEFAULT_EVIDENCE_FORM },
    startsAtLocal: "",
    endsAtLocal: "",
    isRepeatable: false,
    maxCompletions: "",
    sponsorName: "",
    externalRewardNote: "",
  };
}

export function formValuesFromDefinition(deed: DeskDeedDefinition): DeedFormValues {
  const mode = rewardModeFromReward(deed.reward);
  return {
    title: deed.title,
    slug: deed.slug ?? "",
    category: deed.category ?? "",
    loreDescription: deed.loreDescription,
    instructions: deed.instructions,
    accessScope:
      deed.accessScope === "greenwood" ? "greenwood" : "road",
    isPublic: deed.isPublic,
    rewardMode: mode,
    fixedAmount:
      deed.reward.type === "fixed" ? String(deed.reward.amount) : "",
    minAmount: deed.reward.type === "range" ? String(deed.reward.min) : "",
    maxAmount: deed.reward.type === "range" ? String(deed.reward.max) : "",
    evidence: deed.evidenceRequirementsInvalid
      ? { ...DEFAULT_EVIDENCE_FORM }
      : { ...deed.evidenceRequirements },
    startsAtLocal: isoToLocalDatetime(deed.startsAt),
    endsAtLocal: isoToLocalDatetime(deed.endsAt),
    isRepeatable: deed.isRepeatable,
    maxCompletions:
      deed.maxCompletions != null ? String(deed.maxCompletions) : "",
    sponsorName: deed.sponsorName ?? "",
    externalRewardNote: deed.externalRewardNote ?? "",
  };
}

export function buildCreatePayload(values: DeedFormValues): {
  ok: true;
  body: Record<string, unknown>;
} | { ok: false; error: string } {
  if (!values.title.trim()) {
    return { ok: false, error: "Title is required." };
  }
  const reward = rewardPayloadFromForm(
    values.rewardMode,
    values.fixedAmount,
    values.minAmount,
    values.maxAmount,
  );
  if (!reward.ok) return reward;
  if (!hasAnyAllowedEvidence(values.evidence)) {
    return { ok: false, error: "At least one evidence type must be allowed." };
  }
  const maxCompletions = parseOptionalMaxCompletions(values.maxCompletions);
  if (!maxCompletions.ok) return maxCompletions;

  const startsAt = localDatetimeToIso(values.startsAtLocal);
  const endsAt = localDatetimeToIso(values.endsAtLocal);
  if (values.startsAtLocal.trim() && !startsAt) {
    return { ok: false, error: "Starts time is invalid." };
  }
  if (values.endsAtLocal.trim() && !endsAt) {
    return { ok: false, error: "Ends time is invalid." };
  }
  if (startsAt && endsAt && Date.parse(endsAt) < Date.parse(startsAt)) {
    return { ok: false, error: "Ends must be on or after starts." };
  }

  return {
    ok: true,
    body: {
      title: values.title.trim(),
      slug: values.slug.trim() || undefined,
      category: values.category.trim() || null,
      loreDescription: values.loreDescription,
      instructions: values.instructions,
      accessScope: values.accessScope as DeedAccessScope,
      isPublic: values.isPublic,
      reward: reward.reward,
      evidenceRequirements: values.evidence,
      startsAt,
      endsAt,
      maxCompletions: maxCompletions.value,
      isRepeatable: values.isRepeatable,
      sponsorName: values.sponsorName.trim() || null,
      externalRewardNote: values.externalRewardNote.trim() || null,
    },
  };
}

type Props = {
  values: DeedFormValues;
  onChange: (next: DeedFormValues) => void;
  readOnly?: boolean;
  /** When true, auto-suggest slug from title until user edits slug. */
  autoSlug?: boolean;
};

export function DeskDeedDefinitionForm({
  values,
  onChange,
  readOnly = false,
  autoSlug = false,
}: Props) {
  const slugEdited = useRef(!autoSlug);

  useEffect(() => {
    if (autoSlug) slugEdited.current = false;
  }, [autoSlug]);

  function patch(partial: Partial<DeedFormValues>) {
    onChange({ ...values, ...partial });
  }

  function onTitle(title: string) {
    if (!readOnly && autoSlug && !slugEdited.current) {
      patch({ title, slug: suggestSlugFromTitle(title) });
      return;
    }
    patch({ title });
  }

  const fields: Array<{
    key: keyof EvidenceFormState;
    label: string;
  }> = [
    { key: "text", label: "Text" },
    { key: "url", label: "URL" },
    { key: "image", label: "Image" },
    { key: "other", label: "Other" },
  ];

  return (
    <div className="desk-gatherings__form">
      <label className="desk-register__field">
        Title
        <input
          value={values.title}
          disabled={readOnly}
          onChange={(e) => onTitle(e.target.value)}
        />
      </label>
      <label className="desk-register__field">
        Slug
        <input
          value={values.slug}
          disabled={readOnly}
          onChange={(e) => {
            slugEdited.current = true;
            patch({ slug: e.target.value });
          }}
        />
      </label>
      <label className="desk-register__field">
        Category
        <input
          value={values.category}
          disabled={readOnly}
          onChange={(e) => patch({ category: e.target.value })}
        />
      </label>

      <label className="desk-register__field">
        Lore
        <textarea
          rows={3}
          value={values.loreDescription}
          disabled={readOnly}
          onChange={(e) => patch({ loreDescription: e.target.value })}
        />
      </label>
      <label className="desk-register__field">
        What must be done?
        <textarea
          rows={4}
          value={values.instructions}
          disabled={readOnly}
          onChange={(e) => patch({ instructions: e.target.value })}
        />
      </label>

      <fieldset className="desk-register__field" disabled={readOnly}>
        <legend>Access</legend>
        <label>
          <input
            type="radio"
            name="access"
            checked={values.accessScope === "road"}
            onChange={() => patch({ accessScope: "road" })}
          />{" "}
          Road — open to registered outlaws
        </label>
        <label>
          <input
            type="radio"
            name="access"
            checked={values.accessScope === "greenwood"}
            onChange={() => patch({ accessScope: "greenwood" })}
          />{" "}
          Greenwood — members only
        </label>
      </fieldset>

      <label className="desk-register__field">
        <input
          type="checkbox"
          checked={values.isPublic}
          disabled={readOnly}
          onChange={(e) => patch({ isPublic: e.target.checked })}
        />{" "}
        Publicly listed (drafts stay invisible until released)
      </label>

      <fieldset className="desk-register__field" disabled={readOnly}>
        <legend>Reward</legend>
        {(["fixed", "range", "none"] as const).map((mode) => (
          <label key={mode}>
            <input
              type="radio"
              name="reward"
              checked={values.rewardMode === mode}
              onChange={() => {
                if (mode === "none") {
                  patch({
                    rewardMode: mode,
                    fixedAmount: "",
                    minAmount: "",
                    maxAmount: "",
                  });
                  return;
                }
                if (mode === "fixed") {
                  patch({
                    rewardMode: mode,
                    minAmount: "",
                    maxAmount: "",
                  });
                  return;
                }
                patch({
                  rewardMode: mode,
                  fixedAmount: "",
                });
              }}
            />{" "}
            {mode === "fixed"
              ? "Fixed LEAF"
              : mode === "range"
                ? "LEAF range"
                : "No LEAF"}
          </label>
        ))}
        {values.rewardMode === "fixed" ? (
          <label className="desk-register__field">
            Amount
            <input
              value={values.fixedAmount}
              inputMode="numeric"
              onChange={(e) => patch({ fixedAmount: e.target.value })}
            />
          </label>
        ) : null}
        {values.rewardMode === "range" ? (
          <>
            <label className="desk-register__field">
              Minimum
              <input
                value={values.minAmount}
                inputMode="numeric"
                onChange={(e) => patch({ minAmount: e.target.value })}
              />
            </label>
            <label className="desk-register__field">
              Maximum
              <input
                value={values.maxAmount}
                inputMode="numeric"
                onChange={(e) => patch({ maxAmount: e.target.value })}
              />
            </label>
          </>
        ) : null}
      </fieldset>

      <fieldset className="desk-register__field" disabled={readOnly}>
        <legend>Evidence</legend>
        {fields.map(({ key, label }) => (
          <div key={key}>
            <strong>{label}</strong>{" "}
            <label>
              <input
                type="checkbox"
                checked={values.evidence[key].allowed}
                onChange={(e) =>
                  patch({
                    evidence: setEvidenceAllowed(
                      values.evidence,
                      key,
                      e.target.checked,
                    ),
                  })
                }
              />{" "}
              Allowed
            </label>{" "}
            <label>
              <input
                type="checkbox"
                checked={values.evidence[key].required}
                onChange={(e) =>
                  patch({
                    evidence: setEvidenceRequired(
                      values.evidence,
                      key,
                      e.target.checked,
                    ),
                  })
                }
              />{" "}
              Required
            </label>
          </div>
        ))}
      </fieldset>

      <label className="desk-register__field">
        Starts
        <input
          type="datetime-local"
          value={values.startsAtLocal}
          disabled={readOnly}
          onChange={(e) => patch({ startsAtLocal: e.target.value })}
        />
      </label>
      <label className="desk-register__field">
        Ends
        <input
          type="datetime-local"
          value={values.endsAtLocal}
          disabled={readOnly}
          onChange={(e) => patch({ endsAtLocal: e.target.value })}
        />
      </label>

      <label className="desk-register__field">
        <input
          type="checkbox"
          checked={values.isRepeatable}
          disabled={readOnly}
          onChange={(e) => patch({ isRepeatable: e.target.checked })}
        />{" "}
        Repeatable (multiple approved completions per outlaw)
      </label>
      <label className="desk-register__field">
        Maximum completions
        <input
          value={values.maxCompletions}
          disabled={readOnly}
          inputMode="numeric"
          placeholder="optional"
          onChange={(e) => patch({ maxCompletions: e.target.value })}
        />
      </label>

      <label className="desk-register__field">
        Sponsor name
        <input
          value={values.sponsorName}
          disabled={readOnly}
          onChange={(e) => patch({ sponsorName: e.target.value })}
        />
      </label>
      <label className="desk-register__field">
        External reward note
        <input
          value={values.externalRewardNote}
          disabled={readOnly}
          onChange={(e) => patch({ externalRewardNote: e.target.value })}
        />
      </label>
    </div>
  );
}
