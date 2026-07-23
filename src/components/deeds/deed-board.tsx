import { DeedBoardEntry } from "@/components/deeds/deed-board-entry";
import type { SafeDeed } from "@/lib/deeds/types";

type DeedBoardProps = {
  deeds: SafeDeed[];
};

export function DeedBoard({ deeds }: DeedBoardProps) {
  if (deeds.length === 0) {
    return (
      <div className="deed-board__empty" role="status">
        <p>the board is empty.</p>
        <p className="muted">work will appear here.</p>
      </div>
    );
  }

  return (
    <ol className="deed-board__list">
      {deeds.map((deed, index) => (
        <DeedBoardEntry key={deed.id} deed={deed} index={index} />
      ))}
    </ol>
  );
}
