"use client";

import { useState } from "react";

import { CampCharacterCard } from "@/components/camp/camp-character-card";
import {
  CAMP_CHARACTERS,
  type CampCharacterId,
} from "@/components/camp/camp-characters";
import { CampLeafText } from "@/components/camp/camp-leaf-text";

export function CampGround() {
  const [activeId, setActiveId] = useState<CampCharacterId | null>(null);

  const active = CAMP_CHARACTERS.find((c) => c.id === activeId) ?? null;
  const others = CAMP_CHARACTERS.filter((c) => c.id !== activeId);

  return (
    <div className="camp">
      <header className="camp__intro">
        <h1 className="place__title">THE CAMP</h1>
        <p>the fire is low.</p>
        <p className="muted">someone moved a chair.</p>
        <p className="muted">three voices remain.</p>
        <p className="camp__intro-clue muted">
          good conversation leaves something behind.
        </p>
      </header>

      <aside className="camp__leaf-note" aria-label="leaf note">
        <hr className="camp__leaf-rule" />
        <p className="camp__leaf-note-title">
          <CampLeafText text="LEAF CAN BE FOUND HERE." />
        </p>
        <p className="muted">not every conversation earns it.</p>
        <p className="muted">noise earns nothing.</p>
      </aside>

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
