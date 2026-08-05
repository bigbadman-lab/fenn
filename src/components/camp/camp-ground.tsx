"use client";

import { useState } from "react";
import Link from "next/link";

import { CampCharacterCard } from "@/components/camp/camp-character-card";
import {
  CAMP_CHARACTERS,
  type CampCharacterId,
} from "@/components/camp/camp-characters";
import { CampLeafReadout } from "@/components/camp/camp-leaf-readout";
import { CampLeafText } from "@/components/camp/camp-leaf-text";
import { FirstThirtyProgressPanel } from "@/components/first-thirty/first-thirty-progress";
import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { useFirstThirtyProgress } from "@/hooks/use-first-thirty";
import {
  shouldShowActiveFirstThirty,
  shouldShowGreenwoodOpenAction,
} from "@/lib/first-thirty/presentation";
import { AsciiPageTitle } from "@/components/ui/ascii-page-title";

export function CampGround() {
  const [activeId, setActiveId] = useState<CampCharacterId | null>(null);
  const { authenticated, registered } = useFennAuth();
  const { progress } = useFirstThirtyProgress(
    Boolean(authenticated && registered),
  );

  const active = CAMP_CHARACTERS.find((c) => c.id === activeId) ?? null;
  const others = CAMP_CHARACTERS.filter((c) => c.id !== activeId);

  return (
    <div className="camp">
      <div className="camp__intro">
        <AsciiPageTitle
          title="THE CAMP"
          mark="CAMP"
          accent="camp"
          subtitle={<p className="camp__fire-line">the fire is low.</p>}
        />

        <aside className="camp__leaf-note" aria-label="leaf">
          <p className="camp__leaf-note-title">
            <CampLeafText text="LEAF CAN BE FOUND HERE." />
          </p>
          <p className="muted camp__leaf-note-line">
            Not every word leaves a mark.
          </p>
          <p className="muted camp__leaf-note-line">
            Words that carry weight may leave{" "}
            <CampLeafText text="LEAF" /> behind.
          </p>
          <CampLeafReadout />
          {shouldShowActiveFirstThirty(progress) && progress ? (
            <div className="camp__ft-panel">
              <FirstThirtyProgressPanel progress={progress} variant="panel" />
            </div>
          ) : null}
          {shouldShowGreenwoodOpenAction(progress) && progress ? (
            <div className="camp__ft-panel">
              <FirstThirtyProgressPanel progress={progress} />
            </div>
          ) : null}
        </aside>
      </div>

      <section className="camp__how" aria-labelledby="camp-how-title">
        <h2 id="camp-how-title" className="camp__how-title">
          HOW THE CAMP WORKS
        </h2>
        <div className="camp__how-body">
          <p>Speak with care.</p>
          <p>The Fire does not answer noise.</p>
          <p className="muted">
            Ask something you genuinely want answered.
          </p>
          <p className="muted">Offer a thought worth carrying forward.</p>
          <p>three voices live here.</p>
          <p>choose one.</p>
        </div>
        <ul className="camp__how-roles">
          <li>
            <span className="camp__how-role-name camp__how-role-name--fenn">
              FENN
            </span>
            <span className="muted">
              {" "}
              — for the wood, the crown, circulation, philosophy.
            </span>
          </li>
          <li>
            <span className="camp__how-role-name camp__how-role-name--wren">
              WREN
            </span>
            <span className="muted">
              {" "}
              — for reflection, ideas, meaning, observation.
            </span>
          </li>
          <li>
            <span className="camp__how-role-name camp__how-role-name--rook">
              ROOK
            </span>
            <span className="muted">
              {" "}
              — for robinhood chain, markets, projects, discoveries.
            </span>
          </li>
        </ul>
        <p className="camp__how-aside muted">
          conversations will persist when the wood is ready to remember them.
        </p>
      </section>

      <section className="camp__clearing" aria-labelledby="camp-clearing-title">
        <h2 id="camp-clearing-title" className="camp__how-title">
          THE CLEARING
        </h2>
        <div className="camp__how-body">
          <p>Where Outlaws gather in the open.</p>
          <p className="muted">
            Anyone may listen. Only Outlaws may speak.
          </p>
          <p className="muted">
            No LEAF is awarded automatically here.
          </p>
          <p className="muted">
            The voices below — FENN, WREN, ROOK — remain one-to-one Camp
            conversations; those still follow their own LEAF law.
          </p>
        </div>
        <p className="camp__clearing-action">
          <Link href="/camp/clearing" className="btn-text">
            [ GO TO THE CLEARING ]
          </Link>
        </p>
      </section>

      {active ? (
        <div className="camp__active">
          <CampCharacterCard
            character={active}
            expanded
            onSpeak={() => undefined}
            onClose={() => setActiveId(null)}
          />
        </div>
      ) : null}

      <div
        className={
          active ? "camp__roster camp__roster--summary" : "camp__roster"
        }
      >
        {(active ? others : CAMP_CHARACTERS).map((character) => (
          <CampCharacterCard
            key={character.id}
            character={character}
            expanded={false}
            onSpeak={() => setActiveId(character.id)}
            onClose={() => undefined}
          />
        ))}
      </div>
    </div>
  );
}
