"use client";

import type { CampCharacter } from "@/components/camp/camp-characters";
import { CampConversation } from "@/components/camp/camp-conversation";
import { CampLeafText } from "@/components/camp/camp-leaf-text";

type CampCharacterCardProps = {
  character: CampCharacter;
  expanded: boolean;
  onSpeak: () => void;
  onClose: () => void;
};

export function CampCharacterCard({
  character,
  expanded,
  onSpeak,
  onClose,
}: CampCharacterCardProps) {
  const style = {
    ["--camp-accent" as string]: character.accent,
  };

  if (expanded) {
    return (
      <article
        className={`camp-box camp-box--expanded camp-box--${character.id}`}
        style={style}
        aria-labelledby={`camp-${character.id}-name`}
      >
        <header className="camp-box__head">
          <h2 id={`camp-${character.id}-name`} className="camp-box__name">
            {character.name}
          </h2>
          <p className="camp-box__role">{character.role}</p>
        </header>

        <pre className="ascii camp-box__ascii" aria-hidden="true">
          {character.ascii}
        </pre>

        <ul className="camp-box__themes">
          {character.themes.map((theme) => (
            <li key={theme}>{theme}</li>
          ))}
        </ul>

        <p className="camp-box__status">{character.status}</p>
        <p className="camp-box__leaf-clue">
          <CampLeafText text={character.leafClue} />
        </p>

        <CampConversation
          key={character.id}
          characterId={character.id}
          characterName={character.name}
        />

        <p>
          <button type="button" className="btn-text" onClick={onClose}>
            [ close ]
          </button>
        </p>
      </article>
    );
  }

  return (
    <article
      className={`camp-box camp-box--collapsed camp-box--${character.id}`}
      style={style}
      aria-labelledby={`camp-${character.id}-name`}
    >
      <header className="camp-box__head">
        <h2 id={`camp-${character.id}-name`} className="camp-box__name">
          {character.name}
        </h2>
        <p className="camp-box__role">{character.role}</p>
      </header>

      <pre className="ascii camp-box__ascii" aria-hidden="true">
        {character.ascii}
      </pre>

      <ul className="camp-box__themes">
        {character.themes.map((theme) => (
          <li key={theme}>{theme}</li>
        ))}
      </ul>

      <p className="camp-box__status">{character.status}</p>
      <p className="camp-box__leaf-clue">
        <CampLeafText text={character.leafClue} />
      </p>

      <p>
        <button type="button" className="btn-text" onClick={onSpeak}>
          [ speak ]
        </button>
      </p>
    </article>
  );
}
