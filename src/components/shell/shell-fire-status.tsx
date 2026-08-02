"use client";

import Link from "next/link";

import { useFirePresenceShell } from "@/components/shell/fire-presence-provider";

/**
 * Compact top-right Fire readiness. Visible only while actively seated.
 */
export function ShellFireStatus() {
  const { seated } = useFirePresenceShell();
  if (!seated) return null;

  return (
    <Link
      href="/greenwood#the-fire"
      className="shell-fire-status"
      aria-label="Return to the Fire"
    >
      <span className="shell-fire-status__full" aria-hidden="true">
        ● AT THE FIRE
      </span>
      <span className="shell-fire-status__short" aria-hidden="true">
        ● FIRE
      </span>
    </Link>
  );
}
