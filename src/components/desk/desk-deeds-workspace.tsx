"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { DeskDeedDefinitionsBoard } from "@/components/desk/desk-deed-definitions-board";
import { DeskDeedsBoard } from "@/components/desk/desk-deeds-board";

function DeskDeedsWorkspaceInner() {
  const search = useSearchParams();
  const view =
    search.get("view") === "submissions" ? "submissions" : "definitions";

  if (view === "submissions") {
    return <DeskDeedsBoard />;
  }
  return <DeskDeedDefinitionsBoard />;
}

export function DeskDeedsWorkspace() {
  return (
    <Suspense fallback={<p className="muted">…</p>}>
      <DeskDeedsWorkspaceInner />
    </Suspense>
  );
}
