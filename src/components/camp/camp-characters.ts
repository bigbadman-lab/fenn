export type CampCharacterId = "fenn" | "wren" | "rook";

export type CampCharacter = {
  id: CampCharacterId;
  name: string;
  role: string;
  themes: string[];
  status: string;
  accent: string;
  ascii: string;
  placeholder: string;
  /** In-world LEAF clue; may contain the word LEAF for accent styling. */
  leafClue: string;
};

export const CAMP_CHARACTERS: CampCharacter[] = [
  {
    id: "fenn",
    name: "FENN",
    role: "the outlaw",
    themes: ["circulation", "the crown", "the wood"],
    status: "awake.",
    accent: "#B7F34A",
    ascii: `    /\\
   /  \\
  /_/\\_\\
    ||
   FENN`,
    placeholder: "the fire is not listening yet.",
    leafClue: "thought worth carrying may earn LEAF.",
  },
  {
    id: "wren",
    name: "WREN",
    role: "the listener",
    themes: ["reflection", "ideas", "meaning"],
    status: "listening.",
    accent: "#C9A0DC",
    ascii: `   .-.
  ( o )
   \\|/
  --+--
   /|\\
  ' | '
    w`,
    placeholder: "the fire is not listening yet.",
    leafClue: "she rewards what makes her listen twice.",
  },
  {
    id: "rook",
    name: "ROOK",
    role: "the watcher",
    themes: ["robinhood chain", "markets", "discoveries"],
    status: "watching the road.",
    accent: "#E08A3C",
    ascii: `   /\\
  |##|
  |##|
  |##|
 /|##|\\
' |  | '
  ROOK`,
    placeholder: "the fire is not listening yet.",
    leafClue: "bring him something worth knowing.",
  },
];
