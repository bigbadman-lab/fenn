"use client";

import Link from "next/link";

import { AsciiPageTitle } from "@/components/ui/ascii-page-title";
import { formatDeedBoardDate } from "@/lib/deeds/format";
import type { GreenwoodMemberSnapshotView } from "@/lib/greenwood/gate-view";
import { GREENWOOD_MEMBER_PATHS } from "@/lib/greenwood/member-paths";

type GreenwoodMemberProps = {
  outlawLabel: string;
  alias: string | null;
  member: GreenwoodMemberSnapshotView;
};

/**
 * Stage 8.4 admitted-member Greenwood surface.
 * No treasury, circulations, Fire chat, or Notice Tree CRUD.
 */
export function GreenwoodMember({
  outlawLabel,
  alias,
  member,
}: GreenwoodMemberProps) {
  const enteredDate = formatDeedBoardDate(member.greenwoodEnteredAt);
  const aliasTrimmed = alias?.trim() || null;

  return (
    <article
      className="place greenwood-member greenwood-gate--admitted"
      aria-live="polite"
    >
      <header className="greenwood-member__header">
        <AsciiPageTitle
          title="THE GREENWOOD"
          mark="GREENWOOD"
          accent="greenwood"
          subtitle={
            <>
              <p>the gate is behind you.</p>
              <p className="greenwood-member__outlaw">{outlawLabel}</p>
              {aliasTrimmed ? (
                <p className="muted">known as {aliasTrimmed}</p>
              ) : null}
            </>
          }
        />
      </header>

      <div className="greenwood-member__body">
        <p>you are inside.</p>
        <p>
          entered the wood with {member.lifetimeLeafAtEntry} lifetime LEAF.
        </p>
        {enteredDate ? (
          <p className="muted greenwood-member__entered">
            entered {enteredDate}
          </p>
        ) : null}

        <hr className="greenwood-member__rule" />

        <nav className="greenwood-member__paths" aria-label="Greenwood paths">
          <h2 className="greenwood-member__section-title">THE PATHS</h2>
          <ul className="greenwood-member__path-list">
            {GREENWOOD_MEMBER_PATHS.map((path) => (
              <li key={path.href} className="greenwood-member__path">
                <Link href={path.href} className="greenwood-member__path-link">
                  [ {path.label} ]
                </Link>
                <p className="muted greenwood-member__path-note">{path.note}</p>
              </li>
            ))}
          </ul>
        </nav>

        <hr className="greenwood-member__rule" />

        <section
          className="greenwood-member__notice"
          aria-label="Notice Tree"
        >
          <h2 className="greenwood-member__section-title">THE NOTICE TREE</h2>
          <p>the tree is quiet.</p>
          <p className="muted">nothing has been pinned here yet.</p>
        </section>

        <hr className="greenwood-member__rule" />

        <section className="greenwood-member__fire" aria-label="The Fire">
          <h2 className="greenwood-member__section-title">THE FIRE</h2>
          <p className="muted">cold for now.</p>
        </section>
      </div>
    </article>
  );
}
