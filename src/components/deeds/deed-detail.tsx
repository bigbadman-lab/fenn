import Link from "next/link";

import { DeedSubmissionPanel } from "@/components/deeds/deed-submission-panel";
import type { SafeDeed } from "@/lib/deeds/types";
import {
  formatAccessScope,
  formatCategoryLabel,
  formatDeedBoardDate,
  formatDeedReward,
  formatEvidenceDetail,
  formatRepeatability,
} from "@/lib/deeds/format";
import { isDeedOpenForSubmission } from "@/lib/deeds/rules";

type DeedDetailProps = {
  deed: SafeDeed;
};

export function DeedDetail({ deed }: DeedDetailProps) {
  const category = formatCategoryLabel(deed.category);
  const closes = formatDeedBoardDate(deed.endsAt);
  const opens = formatDeedBoardDate(deed.startsAt);
  const evidenceLabel = deed.evidenceRequirementsInvalid
    ? "requirements unavailable"
    : formatEvidenceDetail(deed.evidenceRequirements);
  const open = isDeedOpenForSubmission(deed);

  return (
    <article className="deed-detail">
      <header className="deed-detail__header">
        <p className="deed-detail__eyebrow" aria-hidden="true">
          DEED{category ? ` / ${category}` : ""}
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
          <dt>SCOPE</dt>
          <dd>{formatAccessScope(deed.accessScope)}</dd>
        </div>
      </dl>

      {(deed.sponsorName ||
        deed.externalRewardNote ||
        opens ||
        closes ||
        deed.maxCompletions != null) && (
        <aside className="deed-detail__aside" aria-label="notice details">
          {deed.sponsorName ? (
            <p>
              <span className="deed-detail__label">sponsor</span>{" "}
              {deed.sponsorName}
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
          ) : null}
        </aside>
      )}

      <section
        className="deed-detail__instructions"
        aria-labelledby="deed-instructions-title"
      >
        <h2 id="deed-instructions-title" className="deed-detail__section-title">
          INSTRUCTIONS
        </h2>
        <p className="deed-detail__instructions-body">{deed.instructions}</p>
      </section>

      <DeedSubmissionPanel
        deedId={deed.id}
        evidenceRequirements={deed.evidenceRequirements}
        evidenceRequirementsInvalid={deed.evidenceRequirementsInvalid}
        isRepeatable={deed.isRepeatable}
        isOpenForSubmission={open.open}
        accessScope={deed.accessScope}
      />

      <nav className="deed-detail__nav" aria-label="board">
        <Link href="/deeds">[ return to the board ]</Link>
      </nav>
    </article>
  );
}
