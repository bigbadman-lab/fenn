"use client";

import type { DeskDeedDefinition } from "@/lib/desk/deed-definition-types";
import {
  formatAccessScope,
  formatDeedBoardDate,
  formatDeedReward,
  formatEvidenceDetail,
  formatRepeatability,
} from "@/lib/deeds/format";

type Props = {
  deed: DeskDeedDefinition;
  draftLabel?: boolean;
};

/** Desk-side public presentation reuse without submission panel. */
export function DeskDeedPreview({ deed, draftLabel }: Props) {
  const evidenceLabel = deed.evidenceRequirementsInvalid
    ? "requirements unavailable"
    : formatEvidenceDetail(deed.evidenceRequirements);
  const opens = formatDeedBoardDate(deed.startsAt);
  const closes = formatDeedBoardDate(deed.endsAt);

  return (
    <article className="deed-detail desk-deed-preview" aria-label="Deed preview">
      {draftLabel || deed.status === "draft" ? (
        <p className="muted">Not yet published</p>
      ) : deed.status === "active" ? (
        <p className="muted">As Outlaws see it</p>
      ) : (
        <p className="muted">Record preview</p>
      )}
      <header className="deed-detail__header">
        <p className="deed-detail__eyebrow" aria-hidden="true">
          DEED
          {deed.category ? ` / ${deed.category}` : ""}
        </p>
        <h1 className="deed-detail__title">{deed.title}</h1>
        <p className="deed-detail__lore">{deed.loreDescription}</p>
      </header>

      <dl className="deed-detail__facts">
        <div className="deed-detail__fact">
          <dt>REWARD</dt>
          <dd>{formatDeedReward(deed.reward)}</dd>
        </div>
        <div className="deed-detail__fact">
          <dt>EVIDENCE</dt>
          <dd>{evidenceLabel}</dd>
        </div>
        <div className="deed-detail__fact">
          <dt>REPEAT</dt>
          <dd>{formatRepeatability(deed.isRepeatable)}</dd>
        </div>
        <div className="deed-detail__fact">
          <dt>WHO</dt>
          <dd>{formatAccessScope(deed.accessScope)}</dd>
        </div>
      </dl>

      <aside className="deed-detail__aside" aria-label="notice details">
        <p>
          <span className="deed-detail__label">board</span>{" "}
          {deed.isPublic ? "listed" : "unlisted"}
        </p>
        {deed.sponsorName ? (
          <p>
            <span className="deed-detail__label">sponsor</span> {deed.sponsorName}
          </p>
        ) : null}
        {deed.externalRewardNote ? (
          <p>
            <span className="deed-detail__label">note</span>{" "}
            {deed.externalRewardNote}
          </p>
        ) : null}
        {opens ? (
          <p>
            <span className="deed-detail__label">opens</span> {opens}
          </p>
        ) : null}
        {closes ? (
          <p>
            <span className="deed-detail__label">closes</span> {closes}
          </p>
        ) : null}
        {deed.maxCompletions != null ? (
          <p>
            <span className="deed-detail__label">cap</span>{" "}
            {deed.completionsCount} / {deed.maxCompletions} completions
          </p>
        ) : (
          <p>
            <span className="deed-detail__label">completions</span>{" "}
            {deed.completionsCount}
          </p>
        )}
      </aside>

      <section className="deed-detail__instructions">
        <h2 className="deed-detail__section-title">INSTRUCTIONS</h2>
        <p className="deed-detail__instructions-body">{deed.instructions}</p>
      </section>
    </article>
  );
}
