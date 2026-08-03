"use client";

import Link from "next/link";

import type { DeskDeedsView } from "@/lib/desk/deeds-view";

export type { DeskDeedsView };

export function DeskDeedsWorkspaceNav({
  activeView,
}: {
  activeView: DeskDeedsView;
}) {
  return (
    <header className="desk-deeds-workspace-nav">
      <div className="desk-hollow__head">
        <h2 className="desk-section-title">DEEDS</h2>
      </div>
      <nav className="desk-register__filters" aria-label="Deeds workspace">
        <Link
          href="/desk/deeds?view=definitions"
          className={
            activeView === "definitions"
              ? "btn-text desk-hollow__filter--active"
              : "btn-text"
          }
        >
          [ DEFINITIONS ]
        </Link>
        <Link
          href="/desk/deeds?view=submissions"
          className={
            activeView === "submissions"
              ? "btn-text desk-hollow__filter--active"
              : "btn-text"
          }
        >
          [ SUBMISSIONS ]
        </Link>
      </nav>
      <p className="muted">
        {activeView === "definitions"
          ? "Write and release work into the world."
          : "Examine proof and decide what the world remembers."}
      </p>
    </header>
  );
}
