import Link from "next/link";

import type { SafeDeed } from "@/lib/deeds/types";
import {
  formatBoardIndex,
  formatCategoryLabel,
  formatDeedBoardDate,
  formatDeedReward,
  formatEvidenceSummary,
  formatRepeatability,
} from "@/lib/deeds/format";

type DeedBoardEntryProps = {
  deed: SafeDeed;
  index: number;
};

export function DeedBoardEntry({ deed, index }: DeedBoardEntryProps) {
  const boardNo = formatBoardIndex(index);
  const category = formatCategoryLabel(deed.category);
  const closes = formatDeedBoardDate(deed.endsAt);
  const href = deed.slug ? `/deeds/${deed.slug}` : null;

  return (
    <li className="deed-notice">
      <div className="deed-notice__rail" aria-hidden="true">
        <span className="deed-notice__index">{boardNo}</span>
        {category ? (
          <span className="deed-notice__category">{category}</span>
        ) : null}
      </div>

      <div className="deed-notice__body">
        <h3 className="deed-notice__title">
          {href ? (
            <Link href={href}>{deed.title}</Link>
          ) : (
            <span>{deed.title}</span>
          )}
        </h3>

        <p className="deed-notice__lore">{deed.loreDescription}</p>

        <dl className="deed-notice__meta">
          <div>
            <dt>reward</dt>
            <dd>{formatDeedReward(deed.reward)}</dd>
          </div>
          <div>
            <dt>evidence</dt>
            <dd>
              {deed.evidenceRequirementsInvalid
                ? "unclear"
                : formatEvidenceSummary(deed.evidenceRequirements)}
            </dd>
          </div>
          <div>
            <dt>repeat</dt>
            <dd>{formatRepeatability(deed.isRepeatable)}</dd>
          </div>
        </dl>

        {closes ? (
          <p className="deed-notice__closes muted">closes {closes}</p>
        ) : null}

        {href ? (
          <p className="deed-notice__action">
            <Link href={href} className="deed-notice__examine">
              [ examine ]
              <span className="visually-hidden"> {deed.title}</span>
            </Link>
          </p>
        ) : null}
      </div>
    </li>
  );
}
