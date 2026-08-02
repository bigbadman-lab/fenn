"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { GreenwoodFireGathering } from "@/components/greenwood/greenwood-fire-gathering";
import { GreenwoodFireHashScroll } from "@/components/greenwood/greenwood-fire-hash-scroll";
import { GreenwoodFireHollow } from "@/components/greenwood/greenwood-fire-hollow";
import { GreenwoodFirePresence } from "@/components/greenwood/greenwood-fire-presence";
import { useFirePresenceShell } from "@/components/shell/fire-presence-provider";
import { AsciiPageTitle } from "@/components/ui/ascii-page-title";
import { formatDeedBoardDate, formatDeedReward } from "@/lib/deeds/format";
import type { SafeDeed } from "@/lib/deeds/types";
import { fetchGreenwoodDeeds } from "@/lib/greenwood/client";
import { fetchGreenwoodSpeaks } from "@/lib/greenwood/client";
import {
  GREENWOOD_FIRE_ASCII,
  GREENWOOD_FIRE_MESSAGE_FALLBACK,
} from "@/lib/greenwood/fire-message";
import type { GreenwoodMemberSnapshotView } from "@/lib/greenwood/gate-view";
import { toRomanNumeral } from "@/lib/greenwood/ranking";

type GreenwoodMemberProps = {
  outlawLabel: string;
  alias: string | null;
  member: GreenwoodMemberSnapshotView;
  newlyAdmitted: boolean;
  getAuthHeaders: () => Promise<HeadersInit | null>;
};

/**
 * Living Greenwood — The Fire member hub.
 * Presence, Gatherings, and The Hollow door. No auto treasury distribution.
 */
export function GreenwoodMember({
  outlawLabel,
  alias,
  member,
  newlyAdmitted,
  getAuthHeaders,
}: GreenwoodMemberProps) {
  const { seated } = useFirePresenceShell();
  const enteredDate = formatDeedBoardDate(member.greenwoodEnteredAt);
  const aliasTrimmed = alias?.trim() || null;
  const displayName = aliasTrimmed ?? outlawLabel;
  const currentLeaf = member.currentLifetimeLeaf ?? member.lifetimeLeafAtEntry;
  const rankRoman = member.standingRank
    ? toRomanNumeral(member.standingRank)
    : "?";
  const sigil = member.sigil ?? null;

  const [deeds, setDeeds] = useState<SafeDeed[] | null>(null);
  const [speaksParagraphs, setSpeaksParagraphs] = useState<string[] | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const headers = await getAuthHeaders();
        if (!headers) {
          if (!cancelled) {
            setDeeds([]);
            setSpeaksParagraphs([...GREENWOOD_FIRE_MESSAGE_FALLBACK]);
          }
          return;
        }
        const [deedsResult, speaksResult] = await Promise.all([
          fetchGreenwoodDeeds(headers),
          fetchGreenwoodSpeaks(headers),
        ]);
        if (cancelled) return;
        setDeeds(deedsResult.ok ? deedsResult.deeds : []);
        setSpeaksParagraphs(
          speaksResult.ok
            ? speaksResult.paragraphs
            : [...GREENWOOD_FIRE_MESSAGE_FALLBACK],
        );
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [getAuthHeaders]);

  const deedsContent = useMemo(() => {
    if (deeds === null) {
      return <p className="muted">the board is listening...</p>;
    }

    if (deeds.length === 0) {
      return (
        <>
          <p>nothing has been asked of the Greenwood yet.</p>
          <p className="muted">work will appear when it is time.</p>
        </>
      );
    }

    return (
      <ul className="greenwood-deeds__list">
        {deeds.map((deed) => (
          <li key={deed.id} className="greenwood-deeds__item">
            <p className="greenwood-deeds__line">
              {deed.slug ? (
                <Link href={`/deeds/${deed.slug}`} className="greenwood-deeds__read">
                  [ {deed.title} ]
                </Link>
              ) : (
                <span>[ {deed.title} ]</span>
              )}{" "}
              <span className="greenwood-deeds__reward">
                {formatDeedReward(deed.reward)}
              </span>{" "}
              {deed.slug ? (
                <Link href={`/deeds/${deed.slug}`} className="greenwood-deeds__read">
                  [ READ ]
                </Link>
              ) : null}
            </p>
          </li>
        ))}
      </ul>
    );
  }, [deeds]);

  return (
    <article
      className={
        seated
          ? "place greenwood-member greenwood-fire greenwood-fire--seated"
          : "place greenwood-member greenwood-fire"
      }
      aria-live="polite"
    >
      <GreenwoodFireHashScroll />
      <header className="greenwood-member__header">
        <AsciiPageTitle
          title="THE FIRE"
          ascii={GREENWOOD_FIRE_ASCII}
          accent="greenwood"
          className={
            seated
              ? "greenwood-fire__hero greenwood-fire__hero--seated"
              : "greenwood-fire__hero"
          }
          subtitle={
            <>
              {newlyAdmitted ? (
                <>
                  <p>you are inside.</p>
                  <p>{member.thresholdAtEntry} LEAF opened the Greenwood.</p>
                  <p className="muted">
                    what you do here determines your place within it.
                  </p>
                </>
              ) : (
                <p>THE GREENWOOD REMEMBERS YOU.</p>
              )}
              <p className="greenwood-member__outlaw">{outlawLabel}</p>
              {aliasTrimmed ? (
                <p className="muted">known as {aliasTrimmed}</p>
              ) : null}
            </>
          }
        />
      </header>

      <div className="greenwood-member__body">
        <section
          className="greenwood-interior__section greenwood-fire__message"
          aria-labelledby="gf-message"
        >
          <h2
            id="gf-message"
            className="greenwood-member__section-title greenwood-member__section-title--fenn"
          >
            FENN SPEAKS
          </h2>
          {(speaksParagraphs ?? GREENWOOD_FIRE_MESSAGE_FALLBACK).map(
            (line, index) => (
              <p key={`${index}-${line.slice(0, 24)}`}>{line}</p>
            ),
          )}
        </section>

        <hr className="greenwood-member__rule" />

        <GreenwoodFireGathering getAuthHeaders={getAuthHeaders} />

        <hr className="greenwood-member__rule" />

        <GreenwoodFirePresence getAuthHeaders={getAuthHeaders} />

        <hr className="greenwood-member__rule" />

        <section
          className="greenwood-interior__section"
          aria-labelledby="gf-place"
        >
          <h2
            id="gf-place"
            className="greenwood-member__section-title greenwood-member__section-title--place"
          >
            YOUR PLACE
          </h2>
          {sigil ? (
            <pre
              className="ascii greenwood-fire__sigil"
              aria-label={sigil.a11yLabel}
            >
              {sigil.asciiBody}
            </pre>
          ) : (
            <p className="muted">your mark has not settled yet.</p>
          )}
          <p className="greenwood-interior__place-line">
            {displayName} · {currentLeaf} LEAF
          </p>
          <p className="muted greenwood-interior__place-line">
            STANDING {rankRoman}
            {member.standingTotalMembers != null ? (
              <> / {member.standingTotalMembers}</>
            ) : null}
          </p>
          {enteredDate ? (
            <p className="muted greenwood-interior__place-line">
              ENTERED {enteredDate}
            </p>
          ) : null}
        </section>

        <hr className="greenwood-member__rule" />

        <section
          className="greenwood-interior__section"
          aria-labelledby="gf-deeds"
        >
          <h2
            id="gf-deeds"
            className="greenwood-member__section-title greenwood-member__section-title--deeds"
          >
            DEEPER DEEDS
          </h2>
          {deedsContent}
        </section>

        <hr className="greenwood-member__rule" />

        <GreenwoodFireHollow getAuthHeaders={getAuthHeaders} />
      </div>
    </article>
  );
}
