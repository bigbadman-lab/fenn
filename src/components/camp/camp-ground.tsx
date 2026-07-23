"use client";

import { useState } from "react";

import { CampCharacterCard } from "@/components/camp/camp-character-card";
import {
  CAMP_CHARACTERS,
  type CampCharacterId,
} from "@/components/camp/camp-characters";
import { CampLeafReadout } from "@/components/camp/camp-leaf-readout";
import { CampLeafText } from "@/components/camp/camp-leaf-text";
import { AsciiPageTitle } from "@/components/ui/ascii-page-title";

export function CampGround() {
  const [activeId, setActiveId] = useState<CampCharacterId | null>(null);

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
        <CampLeafReadout />
      </div>

      <section className="camp__how" aria-labelledby="camp-how-title">
        <h2 id="camp-how-title" className="camp__how-title">
          HOW THE CAMP WORKS
        </h2>
        <div className="camp__how-body">
          <p>three voices live here.</p>
          <p>choose one.</p>
          <p>speak plainly.</p>
          <p>bring something worth keeping.</p>
          <p className="camp__how-pause">
            good conversation may leave <CampLeafText text="LEAF" /> behind.
          </p>
          <p>noise earns nothing.</p>
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

      <aside className="camp__leaf-note" aria-label="leaf note">
        <hr className="camp__leaf-rule" />
        <p className="camp__leaf-note-title">
          <CampLeafText text="LEAF CAN BE FOUND HERE." />
        </p>
        <p className="muted">not every conversation earns it.</p>
        <p className="muted">noise earns nothing.</p>
      </aside>
    </div>
  );
}
