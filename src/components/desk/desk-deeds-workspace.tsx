import { DeskDeedDefinitionsBoard } from "@/components/desk/desk-deed-definitions-board";
import { DeskDeedsBoard } from "@/components/desk/desk-deeds-board";
import { DeskDeedsWorkspaceNav } from "@/components/desk/desk-deeds-workspace-nav";
import type { DeskDeedsView } from "@/lib/desk/deeds-view";

/**
 * Unified Deeds workspace shell.
 * View is chosen by the server from `?view=` so refreshes and deep links
 * always render the correct section without client-only query state.
 */
export function DeskDeedsWorkspace({ view }: { view: DeskDeedsView }) {
  return (
    <section className="desk-deeds-workspace" aria-label="Deeds workspace">
      <DeskDeedsWorkspaceNav activeView={view} />
      {view === "submissions" ? (
        <DeskDeedsBoard />
      ) : (
        <DeskDeedDefinitionsBoard />
      )}
    </section>
  );
}
