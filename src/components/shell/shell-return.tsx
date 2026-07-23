"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Inner pages only — homepage navigation lives in the world map. */
export function ShellReturn() {
  const pathname = usePathname();

  if (!pathname || pathname === "/") {
    return null;
  }

  return (
    <p className="shell-return">
      <Link href="/">[ return ]</Link>
    </p>
  );
}
