"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import {
  isHomePath,
  REGISTER_LOGIN_GUIDE_HREF,
  REGISTER_LOGIN_GUIDE_ID,
  shouldGuideToRegisterAfterAuthChange,
} from "@/lib/home/register-login-guide";

const SCROLL_RETRY_MS = 50;
const SCROLL_RETRY_MAX = 40;

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function scrollRegisterIntoView(): boolean {
  const target = document.getElementById(REGISTER_LOGIN_GUIDE_ID);
  if (!target) return false;

  const hash = `#${REGISTER_LOGIN_GUIDE_ID}`;
  if (window.location.hash !== hash) {
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${hash}`,
    );
  }

  target.scrollIntoView({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "start",
  });
  return true;
}

function scrollRegisterWithRetry(): void {
  let attempts = 0;
  const tick = () => {
    if (scrollRegisterIntoView()) return;
    attempts += 1;
    if (attempts >= SCROLL_RETRY_MAX) return;
    window.setTimeout(tick, SCROLL_RETRY_MS);
  };
  tick();
}

/**
 * After Privy login (or session restore), send unnamed users to CLAIM A NAME
 * on the homepage until they register. Named members are never nudged.
 */
export function PostLoginRegisterGuide() {
  const router = useRouter();
  const pathname = usePathname();
  const {
    privyReady,
    authenticated,
    profileResolved,
    registered,
  } = useFennAuth();

  const prevAuthenticatedRef = useRef<boolean | null>(null);
  const guidedThisSessionRef = useRef(false);
  const pendingHomeScrollRef = useRef(false);

  useEffect(() => {
    if (!privyReady) return;

    if (!authenticated) {
      prevAuthenticatedRef.current = false;
      guidedThisSessionRef.current = false;
      pendingHomeScrollRef.current = false;
      return;
    }

    if (!profileResolved) return;

    if (registered) {
      prevAuthenticatedRef.current = true;
      guidedThisSessionRef.current = false;
      pendingHomeScrollRef.current = false;
      return;
    }

    const shouldGuide =
      !guidedThisSessionRef.current &&
      shouldGuideToRegisterAfterAuthChange({
        prevAuthenticated: prevAuthenticatedRef.current,
        current: {
          privyReady,
          authenticated,
          profileResolved,
          registered,
        },
      });

    prevAuthenticatedRef.current = true;

    if (!shouldGuide) return;

    guidedThisSessionRef.current = true;

    if (isHomePath(pathname)) {
      scrollRegisterWithRetry();
      return;
    }

    pendingHomeScrollRef.current = true;
    router.push(REGISTER_LOGIN_GUIDE_HREF);
  }, [
    privyReady,
    authenticated,
    profileResolved,
    registered,
    pathname,
    router,
  ]);

  // Finish scroll after client navigation lands on `/`.
  useEffect(() => {
    if (!pendingHomeScrollRef.current) return;
    if (!isHomePath(pathname)) return;
    pendingHomeScrollRef.current = false;
    scrollRegisterWithRetry();
  }, [pathname]);

  return null;
}
