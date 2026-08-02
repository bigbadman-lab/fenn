"use client";

import { useEffect, useRef } from "react";

const FIRE_HASHES = new Set(["#the-fire", "#gf-at-fire"]);

/**
 * One-time scroll to AT THE FIRE after the member interior is available.
 * Does not run during the arrival ceremony (component only mounts in interior).
 */
export function GreenwoodFireHashScroll() {
  const scrolled = useRef(false);

  useEffect(() => {
    if (scrolled.current) return;
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!FIRE_HASHES.has(hash)) return;

    const target = document.getElementById("the-fire");
    if (!target) return;

    scrolled.current = true;
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    target.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "start",
    });
  }, []);

  return null;
}
