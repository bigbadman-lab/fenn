"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Inner pages only — homepage shows SiteNav instead. */
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
