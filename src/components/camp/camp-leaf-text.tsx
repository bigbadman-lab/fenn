/** Accent the word LEAF inside Camp lore copy. */
export function CampLeafText({ text }: { text: string }) {
  const parts = text.split(/(LEAF)/g);
  return (
    <>
      {parts.map((part, index) =>
        part === "LEAF" ? (
          <span key={`leaf-${index}`} className="camp-leaf">
            LEAF
          </span>
        ) : (
          <span key={`text-${index}`}>{part}</span>
        ),
      )}
    </>
  );
}
