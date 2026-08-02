"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import type { SafeDeskKeeper } from "@/lib/desk/types";

type SessionResponse = {
  ok?: boolean;
  keeper?: SafeDeskKeeper;
};

type DeskGateContextValue = {
  keeper: SafeDeskKeeper;
  getAuthHeaders: () => Promise<HeadersInit | null>;
  refreshSession: () => Promise<void>;
};

const DeskGateContext = createContext<DeskGateContextValue | null>(null);

export function useDeskGate(): DeskGateContextValue {
  const ctx = useContext(DeskGateContext);
  if (!ctx) {
    throw new Error("useDeskGate must be used within DeskGate");
  }
  return ctx;
}

function DeskQuiet() {
  return (
    <div className="desk desk--quiet">
      <h1 className="desk__title">THE DESK</h1>
      <p className="desk__quiet-line">There is nothing here.</p>
    </div>
  );
}

function DeskNav() {
  const pathname = usePathname();
  const overviewActive = pathname === "/desk";
  const registerActive = pathname.startsWith("/desk/register");
  const fireActive = pathname.startsWith("/desk/fire");
  const gatheringsActive = pathname.startsWith("/desk/gatherings");
  const hollowActive = pathname.startsWith("/desk/hollow");
  const deedsActive = pathname.startsWith("/desk/deeds");
  const treasuryActive = pathname.startsWith("/desk/treasury");
  const bookActive = pathname.startsWith("/desk/book");
  const speaksActive = pathname.startsWith("/desk/speaks");
  const agentActive = pathname.startsWith("/desk/agent");

  return (
    <nav className="desk__nav" aria-label="Desk">
      <Link
        href="/desk"
        className={overviewActive ? "desk__nav-link desk__nav-link--active" : "desk__nav-link"}
      >
        Overview
      </Link>
      <Link
        href="/desk/register"
        className={
          registerActive ? "desk__nav-link desk__nav-link--active" : "desk__nav-link"
        }
      >
        The Register
      </Link>
      <Link
        href="/desk/fire"
        className={fireActive ? "desk__nav-link desk__nav-link--active" : "desk__nav-link"}
      >
        The Fire
      </Link>
      <Link
        href="/desk/gatherings"
        className={
          gatheringsActive ? "desk__nav-link desk__nav-link--active" : "desk__nav-link"
        }
      >
        Gatherings
      </Link>
      <Link
        href="/desk/hollow"
        className={
          hollowActive ? "desk__nav-link desk__nav-link--active" : "desk__nav-link"
        }
      >
        The Hollow
      </Link>
      <Link
        href="/desk/deeds"
        className={deedsActive ? "desk__nav-link desk__nav-link--active" : "desk__nav-link"}
      >
        Deeds
      </Link>
      <Link
        href="/desk/treasury"
        className={
          treasuryActive ? "desk__nav-link desk__nav-link--active" : "desk__nav-link"
        }
      >
        Treasury
      </Link>
      <Link
        href="/desk/book"
        className={bookActive ? "desk__nav-link desk__nav-link--active" : "desk__nav-link"}
      >
        The Book
      </Link>
      <Link
        href="/desk/speaks"
        className={
          speaksActive ? "desk__nav-link desk__nav-link--active" : "desk__nav-link"
        }
      >
        FENN SPEAKS
      </Link>
      <Link
        href="/desk/agent"
        className={agentActive ? "desk__nav-link desk__nav-link--active" : "desk__nav-link"}
      >
        The Agent
      </Link>
    </nav>
  );
}

function DeskChrome({ keeper, children }: { keeper: SafeDeskKeeper; children: ReactNode }) {
  return (
    <div className="desk desk--open">
      <header className="desk__chrome">
        <h1 className="desk__title">THE DESK</h1>
        <p className="desk__lede">The world can be tended from here.</p>
        <div className="desk__keeper desk__keeper--compact" aria-label="Keeper">
          {keeper.sigil ? (
            <pre className="ascii desk__sigil" aria-label={keeper.sigil.a11yLabel}>
              {keeper.sigil.asciiBody}
            </pre>
          ) : null}
          <p className="desk__keeper-label">Keeper</p>
          <p className="desk__keeper-name">{keeper.displayName}</p>
        </div>
        <DeskNav />
      </header>
      <div className="desk__body">{children}</div>
    </div>
  );
}

/**
 * Authenticated session shell. Unmounted on logout so protected state cannot linger.
 */
function DeskGateAuthed({ children }: { children: ReactNode }) {
  const { getAuthHeaders } = useFennAuth();
  const [keeper, setKeeper] = useState<SafeDeskKeeper | null>(null);
  const [resolved, setResolved] = useState(false);
  const sessionGeneration = useRef(0);

  const refreshSession = useCallback(async () => {
    const generation = ++sessionGeneration.current;
    const apply = (next: SafeDeskKeeper | null) => {
      if (generation !== sessionGeneration.current) return;
      setKeeper(next);
      setResolved(true);
    };

    const headers = await getAuthHeaders();
    if (generation !== sessionGeneration.current) return;
    if (!headers) {
      apply(null);
      return;
    }
    try {
      const response = await fetch("/api/desk/session", {
        headers,
        cache: "no-store",
      });
      if (generation !== sessionGeneration.current) return;
      if (!response.ok) {
        apply(null);
        return;
      }
      const data = (await response.json()) as SessionResponse;
      if (generation !== sessionGeneration.current) return;
      apply(data.ok && data.keeper ? data.keeper : null);
    } catch {
      if (generation !== sessionGeneration.current) return;
      apply(null);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void refreshSession();
    return () => {
      // Invalidate any in-flight session response so it cannot reopen The Desk.
      sessionGeneration.current += 1;
    };
  }, [refreshSession]);

  if (!resolved || !keeper) {
    return <DeskQuiet />;
  }

  return (
    <DeskGateContext.Provider
      value={{ keeper, getAuthHeaders, refreshSession }}
    >
      <DeskChrome keeper={keeper}>{children}</DeskChrome>
    </DeskGateContext.Provider>
  );
}

/**
 * Shared Desk access gate for /desk and child routes.
 * Starts quiet. Renders children only after requireFennDeskAccess succeeds.
 * Clears protected children when access is lost (authenticated shell unmounts).
 * Stale session responses cannot reopen The Desk after logout/abort.
 */
export function DeskGate({ children }: { children: ReactNode }) {
  const { privyReady, loading, authenticated } = useFennAuth();

  if (!privyReady || loading || !authenticated) {
    return <DeskQuiet />;
  }

  return <DeskGateAuthed>{children}</DeskGateAuthed>;
}
