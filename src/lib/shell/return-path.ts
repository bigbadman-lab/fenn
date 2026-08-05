/**
 * Whether the shared shell "[ return ]" control should render for this path.
 *
 * Null/empty: hide (prefer no control until path is known).
 * Home: hide always — including Vercel ISR SSR of `/` as `/index`
 * (Next.js #95648; surface is `app/page` → `.next/server/app/index.html`).
 */
export function shouldShowShellReturn(pathname: string | null | undefined): boolean {
  if (!pathname) return false;

  let normalized = pathname.trim();
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  if (normalized === "" || normalized === "/") return false;
  // ISR root canonical mismatch — treat as home, not an inner page.
  if (normalized === "/index") return false;

  return true;
}
