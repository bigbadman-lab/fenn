"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import type { DeskDeedDefinition } from "@/lib/desk/deed-definition-types";
import {
  DEFAULT_EVIDENCE_FORM,
  capChoiceFromMaxCompletions,
  evidenceFromSimpleSelection,
  hasAnyAllowedEvidence,
  isNoEvidenceSelection,
  isSimpleEvidenceConfig,
  isoToLocalDatetime,
  localDatetimeToIso,
  maxCompletionsFromCapChoice,
  parseOptionalMaxCompletions,
  rewardModeFromReward,
  rewardPayloadFromForm,
  setEvidenceAllowed,
  setEvidenceRequired,
  shouldExpandAdvancedInitially,
  simpleEvidenceFromForm,
  suggestSlugFromTitle,
  toggleSimpleEvidence,
  type CapChoice,
  type EvidenceFormState,
  type RewardFormMode,
  type SimpleEvidenceKeys,
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
  /** UI completion choice; drives maxCompletions on save. */
  capMode: CapChoice;
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
    rewardMode: "fixed",
    fixedAmount: "25",
    minAmount: "",
    maxAmount: "",
    evidence: { ...DEFAULT_EVIDENCE_FORM },
    startsAtLocal: "",
    endsAtLocal: "",
    isRepeatable: false,
    capMode: "unlimited",
    maxCompletions: "",
    sponsorName: "",
    externalRewardNote: "",
  };
}

export function formValuesFromDefinition(deed: DeskDeedDefinition): DeedFormValues {
  const mode = rewardModeFromReward(deed.reward);
  const maxStr =
    deed.maxCompletions != null ? String(deed.maxCompletions) : "";
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
      : {
          text: { ...deed.evidenceRequirements.text },
          url: { ...deed.evidenceRequirements.url },
          image: { ...deed.evidenceRequirements.image },
          other: { ...deed.evidenceRequirements.other },
        },
    startsAtLocal: isoToLocalDatetime(deed.startsAt),
    endsAtLocal: isoToLocalDatetime(deed.endsAt),
    isRepeatable: deed.isRepeatable,
    capMode: capChoiceFromMaxCompletions(maxStr),
    maxCompletions: maxStr,
    sponsorName: deed.sponsorName ?? "",
    externalRewardNote: deed.externalRewardNote ?? "",
  };
}

export function buildCreatePayload(values: DeedFormValues): {
  ok: true;
  body: Record<string, unknown>;
} | { ok: false; error: string; field?: string } {
  if (!values.title.trim()) {
    return { ok: false, error: "Title is required.", field: "title" };
  }
  const reward = rewardPayloadFromForm(
    values.rewardMode,
    values.fixedAmount,
    values.minAmount,
    values.maxAmount,
  );
  if (!reward.ok) return { ...reward, field: "reward" };
  if (!hasAnyAllowedEvidence(values.evidence)) {
    return {
      ok: false,
      error: "Choose how Outlaws should prove completion.",
      field: "evidence",
    };
  }

  let maxValue: number | null;
  if (values.capMode === "unlimited") {
    maxValue = null;
  } else if (values.capMode === "first10") {
    maxValue = 10;
  } else {
    const maxCompletions = parseOptionalMaxCompletions(values.maxCompletions);
    if (!maxCompletions.ok) {
      return { ok: false, error: maxCompletions.error, field: "cap" };
    }
    if (maxCompletions.value == null) {
      return {
        ok: false,
        error: "Enter a custom completion limit.",
        field: "cap",
      };
    }
    maxValue = maxCompletions.value;
  }

  const startsAt = localDatetimeToIso(values.startsAtLocal);
  const endsAt = localDatetimeToIso(values.endsAtLocal);
  if (values.startsAtLocal.trim() && !startsAt) {
    return { ok: false, error: "Start time is invalid.", field: "startsAt" };
  }
  if (values.endsAtLocal.trim() && !endsAt) {
    return { ok: false, error: "End time is invalid.", field: "endsAt" };
  }
  if (startsAt && endsAt && Date.parse(endsAt) < Date.parse(startsAt)) {
    return {
      ok: false,
      error: "End must be on or after start.",
      field: "endsAt",
    };
  }

  const instructions = values.instructions.trim();
  // Publish requires both lore and instructions; fill blank lore from instructions.
  const lore =
    values.loreDescription.trim() || instructions;

  return {
    ok: true,
    body: {
      title: values.title.trim(),
      slug: values.slug.trim() || undefined,
      category: values.category.trim() || null,
      loreDescription: lore,
      instructions: values.instructions,
      accessScope: values.accessScope as DeedAccessScope,
      isPublic: values.isPublic,
      reward: reward.reward,
      evidenceRequirements: values.evidence,
      startsAt,
      endsAt,
      maxCompletions: maxValue,
      isRepeatable: values.isRepeatable,
      sponsorName: values.sponsorName.trim() || null,
      externalRewardNote: values.externalRewardNote.trim() || null,
    },
  };
}

/** Extra client checks before calling publish (server remains source of truth). */
export function validateForPublish(values: DeedFormValues): {
  ok: true;
} | { ok: false; error: string; field?: string } {
  const base = buildCreatePayload(values);
  if (!base.ok) return base;
  if (!values.instructions.trim()) {
    return {
      ok: false,
      error: "Describe what Outlaws must do before publishing.",
      field: "instructions",
    };
  }
  if (values.rewardMode === "fixed") {
    const amount = Number.parseInt(values.fixedAmount, 10);
    if (!Number.isInteger(amount) || amount < 0) {
      return {
        ok: false,
        error: "Enter a fixed LEAF amount (0 or greater).",
        field: "reward",
      };
    }
  }
  if (values.rewardMode === "range") {
    const range = rewardPayloadFromForm(
      "range",
      values.fixedAmount,
      values.minAmount,
      values.maxAmount,
    );
    if (!range.ok) return { ...range, field: "reward" };
  }
  if (isNoEvidenceSelection(values.evidence)) {
    // Allowed for save; publish still has an allowed type (optional text).
    // No extra block — server accepts this shape.
  }
  const slug = values.slug.trim() || suggestSlugFromTitle(values.title);
  if (!slug) {
    return {
      ok: false,
      error: "Add a title so a page path can be generated.",
      field: "title",
    };
  }
  return { ok: true };
}

type Props = {
  values: DeedFormValues;
  onChange: (next: DeedFormValues) => void;
  readOnly?: boolean;
  /** When true, auto-suggest slug from title until user edits slug. */
  autoSlug?: boolean;
  /** When true, Advanced starts expanded (e.g. existing complex deed). */
  preferAdvancedOpen?: boolean;
  fieldError?: string | null;
  errorField?: string | null;
};

function ChoiceButton({
  selected,
  disabled,
  onClick,
  children,
  id,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  id?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      className={
        selected
          ? "desk-deed-write__choice desk-deed-write__choice--selected"
          : "desk-deed-write__choice"
      }
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function DeskDeedDefinitionForm({
  values,
  onChange,
  readOnly = false,
  autoSlug = false,
  preferAdvancedOpen = false,
  fieldError = null,
  errorField = null,
}: Props) {
  const slugEdited = useRef(!autoSlug);
  const [advancedOpen, setAdvancedOpen] = useState(preferAdvancedOpen);
  const titleId = useId();
  const instructionsId = useId();
  const loreId = useId();
  const rewardAmountId = useId();
  const customCapId = useId();
  const formErrorId = useId();

  useEffect(() => {
    if (autoSlug) slugEdited.current = false;
  }, [autoSlug]);

  useEffect(() => {
    if (preferAdvancedOpen) setAdvancedOpen(true);
  }, [preferAdvancedOpen]);

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

  const simple = isSimpleEvidenceConfig(values.evidence);
  const evidenceSel = simple
    ? simpleEvidenceFromForm(values.evidence)
    : { screenshot: false, link: false, written: false, none: false };

  const capChoice = values.capMode;
  const customCapValue =
    capChoice === "custom" ? values.maxCompletions : "";

  // Primary reward: none | fixed. Range kept via Advanced.
  const primaryReward: "none" | "fixed" | "other" =
    values.rewardMode === "none"
      ? "none"
      : values.rewardMode === "fixed"
        ? "fixed"
        : "other";

  function setCap(choice: CapChoice) {
    if (choice === "unlimited") {
      patch({ capMode: "unlimited", maxCompletions: "" });
      return;
    }
    if (choice === "first10") {
      patch({ capMode: "first10", maxCompletions: "10" });
      return;
    }
    const current = values.maxCompletions.trim();
    patch({
      capMode: "custom",
      maxCompletions: maxCompletionsFromCapChoice(
        "custom",
        current && current !== "10" ? current : "",
      ),
    });
  }

  function onSimpleEvidence(key: SimpleEvidenceKeys | "none") {
    if (!simple) return;
    patch({ evidence: toggleSimpleEvidence(values.evidence, key) });
  }

  const advancedFields: Array<{
    key: keyof EvidenceFormState;
    label: string;
  }> = [
    { key: "text", label: "Written response" },
    { key: "url", label: "Link" },
    { key: "image", label: "Screenshot" },
    { key: "other", label: "Other" },
  ];

  return (
    <div className="desk-deed-write__form">
      <div className="desk-deed-write__section">
        <label className="desk-deed-write__label" htmlFor={titleId}>
          What should Outlaws do?
        </label>
        <input
          id={titleId}
          className="desk-deed-write__input"
          value={values.title}
          disabled={readOnly}
          aria-invalid={errorField === "title" || undefined}
          aria-describedby={
            errorField === "title" && fieldError ? formErrorId : undefined
          }
          onChange={(e) => onTitle(e.target.value)}
          placeholder="A clear challenge title"
        />
      </div>

      <div className="desk-deed-write__section">
        <label className="desk-deed-write__label" htmlFor={instructionsId}>
          Describe the deed
        </label>
        <p className="desk-deed-write__hint">
          What Outlaws must do. This is the main instruction they will read.
        </p>
        <textarea
          id={instructionsId}
          className="desk-deed-write__textarea"
          rows={6}
          value={values.instructions}
          disabled={readOnly}
          aria-invalid={errorField === "instructions" || undefined}
          aria-describedby={
            errorField === "instructions" && fieldError
              ? formErrorId
              : undefined
          }
          onChange={(e) => patch({ instructions: e.target.value })}
          placeholder="Be specific about the task and what success looks like."
        />
      </div>

      <div className="desk-deed-write__section">
        <label className="desk-deed-write__label" htmlFor={loreId}>
          A word from FENN
        </label>
        <p className="desk-deed-write__hint">
          Optional world colour shown above the instructions. Leave blank to
          reuse the description.
        </p>
        <textarea
          id={loreId}
          className="desk-deed-write__textarea desk-deed-write__textarea--short"
          rows={3}
          value={values.loreDescription}
          disabled={readOnly}
          onChange={(e) => patch({ loreDescription: e.target.value })}
          placeholder="Optional"
        />
      </div>

      <fieldset
        className="desk-deed-write__section"
        disabled={readOnly}
        aria-describedby={
          errorField === "reward" && fieldError ? formErrorId : undefined
        }
      >
        <legend className="desk-deed-write__label">
          How much LEAF is it worth?
        </legend>
        <div className="desk-deed-write__choices" role="group">
          <ChoiceButton
            selected={primaryReward === "none"}
            disabled={readOnly}
            onClick={() =>
              patch({
                rewardMode: "none",
                fixedAmount: "",
                minAmount: "",
                maxAmount: "",
              })
            }
          >
            No reward
          </ChoiceButton>
          <ChoiceButton
            selected={primaryReward === "fixed"}
            disabled={readOnly}
            onClick={() =>
              patch({
                rewardMode: "fixed",
                minAmount: "",
                maxAmount: "",
                fixedAmount: values.fixedAmount || "25",
              })
            }
          >
            Fixed reward
          </ChoiceButton>
          {primaryReward === "other" ? (
            <span className="desk-deed-write__chip-note" aria-live="polite">
              Range reward — edit in Advanced
            </span>
          ) : null}
        </div>
        {values.rewardMode === "fixed" ? (
          <label className="desk-deed-write__inline-amount" htmlFor={rewardAmountId}>
            <span className="visually-hidden">LEAF amount</span>
            <input
              id={rewardAmountId}
              className="desk-deed-write__input desk-deed-write__input--amount"
              value={values.fixedAmount}
              inputMode="numeric"
              disabled={readOnly}
              onChange={(e) => patch({ fixedAmount: e.target.value })}
            />
            <span aria-hidden="true">LEAF</span>
          </label>
        ) : null}
      </fieldset>

      <fieldset
        className="desk-deed-write__section"
        disabled={readOnly}
        aria-describedby={
          errorField === "evidence" && fieldError ? formErrorId : undefined
        }
      >
        <legend className="desk-deed-write__label">
          How should they prove completion?
        </legend>
        {simple ? (
          <div className="desk-deed-write__choices" role="group">
            <ChoiceButton
              selected={evidenceSel.screenshot}
              disabled={readOnly}
              onClick={() => onSimpleEvidence("screenshot")}
            >
              Screenshot
            </ChoiceButton>
            <ChoiceButton
              selected={evidenceSel.link}
              disabled={readOnly}
              onClick={() => onSimpleEvidence("link")}
            >
              Link
            </ChoiceButton>
            <ChoiceButton
              selected={evidenceSel.written}
              disabled={readOnly}
              onClick={() => onSimpleEvidence("written")}
            >
              Written response
            </ChoiceButton>
            <ChoiceButton
              selected={evidenceSel.none}
              disabled={readOnly}
              onClick={() => onSimpleEvidence("none")}
            >
              No evidence
            </ChoiceButton>
          </div>
        ) : (
          <p className="desk-deed-write__hint">
            This deed uses a detailed proof setup. Adjust it in Advanced so
            nothing is lost.
          </p>
        )}
        {simple && evidenceSel.none ? (
          <p className="desk-deed-write__hint">
            Outlaws will not be asked for a required screenshot, link, or
            written answer. A short note may still be accepted if needed.
          </p>
        ) : null}
      </fieldset>

      <fieldset
        className="desk-deed-write__section"
        disabled={readOnly}
        aria-describedby={
          errorField === "cap" && fieldError ? formErrorId : undefined
        }
      >
        <legend className="desk-deed-write__label">Who can complete it?</legend>
        <div className="desk-deed-write__choices" role="group">
          <ChoiceButton
            selected={capChoice === "unlimited"}
            disabled={readOnly}
            onClick={() => setCap("unlimited")}
          >
            Unlimited
          </ChoiceButton>
          <ChoiceButton
            selected={capChoice === "first10"}
            disabled={readOnly}
            onClick={() => setCap("first10")}
          >
            First 10
          </ChoiceButton>
          <ChoiceButton
            selected={capChoice === "custom"}
            disabled={readOnly}
            onClick={() => setCap("custom")}
          >
            Custom limit
          </ChoiceButton>
        </div>
        {capChoice === "custom" ? (
          <label className="desk-deed-write__inline-amount" htmlFor={customCapId}>
            <span className="visually-hidden">Custom completion limit</span>
            <input
              id={customCapId}
              className="desk-deed-write__input desk-deed-write__input--amount"
              value={customCapValue}
              inputMode="numeric"
              disabled={readOnly}
              placeholder="e.g. 50"
              onChange={(e) =>
                patch({
                  capMode: "custom",
                  maxCompletions: e.target.value,
                })
              }
            />
          </label>
        ) : null}
      </fieldset>

      {fieldError ? (
        <p
          id={formErrorId}
          className="desk-deed-write__error"
          role="alert"
        >
          {fieldError}
        </p>
      ) : null}

      <div className="desk-deed-write__advanced">
        <button
          type="button"
          className="desk-deed-write__advanced-toggle"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          ADVANCED {advancedOpen ? "▴" : "▾"}
        </button>
        {advancedOpen ? (
          <div className="desk-deed-write__advanced-body">
            <label className="desk-register__field">
              Page path
              <input
                value={values.slug}
                disabled={readOnly}
                onChange={(e) => {
                  slugEdited.current = true;
                  patch({ slug: e.target.value });
                }}
              />
            </label>
            <p className="desk-deed-write__hint">
              Used in the public URL. Generated from the title when left alone.
            </p>

            <fieldset className="desk-register__field" disabled={readOnly}>
              <legend>Who may take it</legend>
              <label>
                <input
                  type="radio"
                  name="access"
                  checked={values.accessScope === "road"}
                  onChange={() => patch({ accessScope: "road" })}
                />{" "}
                Road — open to registered Outlaws
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
              Listed on the public board when published
            </label>

            <fieldset className="desk-register__field" disabled={readOnly}>
              <legend>Range LEAF reward</legend>
              <label>
                <input
                  type="checkbox"
                  checked={values.rewardMode === "range"}
                  onChange={(e) => {
                    if (e.target.checked) {
                      patch({
                        rewardMode: "range",
                        fixedAmount: "",
                        minAmount: values.minAmount || "1",
                        maxAmount: values.maxAmount || "10",
                      });
                      return;
                    }
                    patch({
                      rewardMode: "fixed",
                      fixedAmount: values.fixedAmount || "25",
                      minAmount: "",
                      maxAmount: "",
                    });
                  }}
                />{" "}
                Use a LEAF range instead of fixed
              </label>
              {values.rewardMode === "range" ? (
                <div className="desk-deed-write__advanced-range">
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
                </div>
              ) : null}
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
              Repeatable (multiple approved completions per Outlaw)
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
                onChange={(e) =>
                  patch({ externalRewardNote: e.target.value })
                }
              />
            </label>

            <label className="desk-register__field">
              Category note
              <input
                value={values.category}
                disabled={readOnly}
                onChange={(e) => patch({ category: e.target.value })}
                placeholder="Optional free text"
              />
            </label>
            <p className="desk-deed-write__hint">
              Free-text label only. Not a typed category system.
            </p>

            <fieldset className="desk-register__field" disabled={readOnly}>
              <legend>Detailed proof settings</legend>
              {!simple ? (
                <p className="desk-deed-write__hint">
                  This configuration mixes optional and required proof
                  types. Saving keeps it intact.
                </p>
              ) : (
                <p className="desk-deed-write__hint">
                  Prefer the simple proof choices above unless you need fine
                  control.
                </p>
              )}
              {advancedFields.map(({ key, label }) => (
                <div key={key} className="desk-deed-write__evidence-row">
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
              {simple ? (
                <button
                  type="button"
                  className="btn-text"
                  disabled={readOnly}
                  onClick={() =>
                    patch({
                      evidence: evidenceFromSimpleSelection({
                        screenshot: true,
                        link: false,
                        written: false,
                        none: false,
                      }),
                    })
                  }
                >
                  [ reset simple proof choices ]
                </button>
              ) : null}
            </fieldset>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { shouldExpandAdvancedInitially };
