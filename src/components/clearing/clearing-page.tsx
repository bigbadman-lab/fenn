"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import {
  ClearingComposer,
  type ComposerIdentity,
} from "@/components/clearing/clearing-composer";
import { ClearingFeedItem } from "@/components/clearing/clearing-feed-item";
import { AsciiPageTitle } from "@/components/ui/ascii-page-title";
import { CLEARING_PUBLIC_POLL_MS } from "@/lib/clearing/config";
import type { SafeClearingMessage } from "@/lib/clearing/dto";
import {
  filterMessageItems,
  findNewMessages,
  mergeConversationMessages,
  newestFirstToConversation,
} from "@/lib/clearing/feed-client";
import type { SafeTravellerIdentity } from "@/lib/clearing/dto";

const POLL_MS = CLEARING_PUBLIC_POLL_MS;
const NEAR_BOTTOM_PX = 96;
const INITIAL_LIMIT = 40;

type FeedState = {
  readOnly: boolean;
  slowModeSeconds: number;
};

type Speaking = "ok" | "muted" | "banned";

export function ClearingPage() {
  const {
    privyReady,
    loading: authLoading,
    authenticated,
    registered,
    profile,
    profileResolved,
  } = useFennAuth();

  const [messages, setMessages] = useState<SafeClearingMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [clearingState, setClearingState] = useState<FeedState>({
    readOnly: false,
    slowModeSeconds: 0,
  });

  const [traveller, setTraveller] = useState<SafeTravellerIdentity | null>(
    null,
  );
  const [speaking, setSpeaking] = useState<Speaking>("ok");
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [slowModeUntil, setSlowModeUntil] = useState<number | null>(null);

  const [unseenCount, setUnseenCount] = useState(0);
  const stickToBottomRef = useRef(true);
  const feedScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fetchInFlight = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const initialScrollDone = useRef(false);
  const mintPromiseRef = useRef<Promise<boolean> | null>(null);

  const identityPending =
    !privyReady || (authenticated && (authLoading || !profileResolved));

  const applyFeedPayload = useCallback(
    (
      data: {
        items?: unknown[];
        nextCursor?: string | null;
        state?: { readOnly?: boolean; slowModeSeconds?: number };
      },
      mode: "replace" | "merge" | "prepend",
    ) => {
      const page = filterMessageItems(data.items ?? []);
      const chronological = newestFirstToConversation(page);

      if (data.state) {
        setClearingState({
          readOnly: Boolean(data.state.readOnly),
          slowModeSeconds: Math.max(0, Number(data.state.slowModeSeconds) || 0),
        });
      }

      if (mode === "replace") {
        setMessages(chronological);
        setOlderCursor(data.nextCursor ?? null);
        return chronological;
      }

      if (mode === "prepend") {
        setMessages((prev) => mergeConversationMessages(prev, chronological));
        setOlderCursor(data.nextCursor ?? null);
        return chronological;
      }

      // merge (poll)
      setMessages((prev) => {
        const fresh = findNewMessages(prev, chronological);
        if (fresh.length > 0 && !stickToBottomRef.current) {
          setUnseenCount((c) => c + fresh.length);
        }
        return mergeConversationMessages(prev, chronological);
      });
      return chronological;
    },
    [],
  );

  const fetchFeed = useCallback(
    async (opts: {
      cursor?: string | null;
      mode: "replace" | "merge" | "prepend";
      signal?: AbortSignal;
    }) => {
      const params = new URLSearchParams();
      params.set("limit", String(INITIAL_LIMIT));
      if (opts.cursor) params.set("cursor", opts.cursor);

      const res = await fetch(`/api/clearing/feed?${params.toString()}`, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        signal: opts.signal,
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        items?: unknown[];
        nextCursor?: string | null;
        state?: { readOnly?: boolean; slowModeSeconds?: number };
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "feed failed");
      }
      applyFeedPayload(data, opts.mode);
    },
    [applyFeedPayload],
  );

  // Initial feed load
  useEffect(() => {
    const ac = new AbortController();
    abortRef.current = ac;
    setFeedLoading(true);
    setFeedError(null);
    void (async () => {
      try {
        await fetchFeed({ mode: "replace", signal: ac.signal });
      } catch (e) {
        if (ac.signal.aborted) return;
        setFeedError("THE CLEARING COULD NOT BE HEARD.");
      } finally {
        if (!ac.signal.aborted) setFeedLoading(false);
      }
    })();
    return () => ac.abort();
  }, [fetchFeed]);

  // Poll while visible
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      if (cancelled || document.visibilityState === "hidden") return;
      if (fetchInFlight.current) return;
      fetchInFlight.current = true;
      const ac = new AbortController();
      try {
        await fetchFeed({ mode: "merge", signal: ac.signal });
      } catch {
        /* tolerate missed polls */
      } finally {
        fetchInFlight.current = false;
      }
    };

    const schedule = () => {
      if (timer != null) window.clearInterval(timer);
      timer = window.setInterval(() => {
        void tick();
      }, POLL_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void tick();
        schedule();
      } else if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer != null) window.clearInterval(timer);
    };
  }, [fetchFeed]);

  // Scroll: track near-bottom + initial stick
  const onFeedScroll = useCallback(() => {
    const el = feedScrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < NEAR_BOTTOM_PX;
    if (stickToBottomRef.current) setUnseenCount(0);
  }, []);

  useEffect(() => {
    if (feedLoading || messages.length === 0) return;
    if (!initialScrollDone.current) {
      initialScrollDone.current = true;
      bottomRef.current?.scrollIntoView({ block: "end" });
      stickToBottomRef.current = true;
      return;
    }
    if (stickToBottomRef.current) {
      bottomRef.current?.scrollIntoView({
        block: "end",
        behavior: "smooth",
      });
    }
  }, [messages, feedLoading]);

  const mintTraveller = useCallback(async (): Promise<boolean> => {
    if (traveller) return true;
    if (mintPromiseRef.current) return mintPromiseRef.current;

    const run = (async () => {
      setMinting(true);
      setMintError(null);
      try {
        const res = await fetch("/api/clearing/traveller", {
          method: "POST",
          credentials: "same-origin",
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          traveller?: SafeTravellerIdentity;
          speaking?: Speaking;
          error?: string;
        };
        if (!res.ok || !data.ok || !data.traveller) {
          setMintError(
            data.error ??
              "could not take a temporary name. you may still read.",
          );
          return false;
        }
        setTraveller(data.traveller);
        setSpeaking(data.speaking ?? "ok");
        if (data.traveller.messagesRemaining <= 0) setExhausted(true);
        return true;
      } catch {
        setMintError("could not take a temporary name. you may still read.");
        return false;
      } finally {
        setMinting(false);
        mintPromiseRef.current = null;
      }
    })();
    mintPromiseRef.current = run;
    return run;
  }, [traveller]);

  // Resume traveller cookie quietly after identity resolves for guests
  useEffect(() => {
    if (identityPending) return;
    if (authenticated) return;
    void mintTraveller();
  }, [authenticated, identityPending, mintTraveller]);

  const loadOlder = useCallback(async () => {
    if (!olderCursor || loadingOlder) return;
    const el = feedScrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    setLoadingOlder(true);
    try {
      await fetchFeed({ cursor: olderCursor, mode: "prepend" });
      requestAnimationFrame(() => {
        if (!el) return;
        el.scrollTop = el.scrollHeight - prevHeight + prevTop;
      });
    } catch {
      /* ignore */
    } finally {
      setLoadingOlder(false);
    }
  }, [fetchFeed, loadingOlder, olderCursor]);

  const jumpToNew = useCallback(() => {
    setUnseenCount(0);
    stickToBottomRef.current = true;
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, []);

  const onAccepted = useCallback(
    (message: SafeClearingMessage, messagesRemaining?: number) => {
      setMessages((prev) => mergeConversationMessages(prev, [message]));
      stickToBottomRef.current = true;
      setUnseenCount(0);
      if (typeof messagesRemaining === "number") {
        setTraveller((t) =>
          t
            ? { ...t, messagesRemaining }
            : {
                displayName: message.author.label,
                messagesRemaining,
                messagesLimit: 3,
              },
        );
        if (messagesRemaining <= 0) setExhausted(true);
      }
      // Soft refresh latest head
      void fetchFeed({ mode: "merge" });
    },
    [fetchFeed],
  );

  const onSpeakBlocked = useCallback((code: string) => {
    if (code === "clearing_muted") setSpeaking("muted");
    if (code === "clearing_banned") setSpeaking("banned");
    if (code === "clearing_read_only") {
      setClearingState((s) => ({ ...s, readOnly: true }));
    }
    if (code === "clearing_registration_required") {
      setExhausted(true);
      setTraveller((t) =>
        t ? { ...t, messagesRemaining: 0 } : t,
      );
    }
  }, []);

  const onSlowMode = useCallback((retryAfterMs: number) => {
    setSlowModeUntil(Date.now() + retryAfterMs);
  }, []);

  // Apply slow_mode floor from global state when set
  useEffect(() => {
    if (clearingState.slowModeSeconds > 0 && !slowModeUntil) {
      // don't force on load — only after a post rejection or successful post would set it
    }
  }, [clearingState.slowModeSeconds, slowModeUntil]);

  const composerIdentity: ComposerIdentity = useMemo(() => {
    if (identityPending) return { kind: "pending" };
    if (clearingState.readOnly) return { kind: "read_only" };
    if (authenticated && !registered) return { kind: "claim_name" };
    if (authenticated && registered && profile) {
      const alias =
        profile.alias?.trim() ||
        `OUTLAW ${String(profile.outlawNumber).padStart(5, "0")}`;
      return { kind: "outlaw", alias, speaking };
    }
    // unauthenticated
    if (exhausted || (traveller && traveller.messagesRemaining <= 0)) {
      return { kind: "registration_threshold" };
    }
    if (!traveller) {
      // Mint in flight or mint-on-speak — avoid false identity flash
      return { kind: "pending" };
    }
    return {
      kind: "traveller",
      displayName: traveller.displayName,
      messagesRemaining: traveller.messagesRemaining,
      speaking,
    };
  }, [
    authenticated,
    clearingState.readOnly,
    exhausted,
    identityPending,
    profile,
    registered,
    speaking,
    traveller,
  ]);

  return (
    <div className="clearing">
      <div className="clearing__intro">
        <AsciiPageTitle
          title="THE CLEARING"
          mark="CLEARING"
          accent="camp"
          subtitle={
            <>
              <p className="clearing__lede">The trees thin here.</p>
              <p className="clearing__lede">Anyone may listen.</p>
              <p className="clearing__lede">
                Travellers may speak three times.
                <br />
                Outlaws may remain.
              </p>
              <p className="muted clearing__leaf-note">
                Nothing spoken here earns LEAF automatically.
              </p>
            </>
          }
        />
        <p className="clearing__nav muted">
          <Link href="/camp">[ back to camp ]</Link>
        </p>
      </div>

      <div className="clearing__stage">
        <div className="clearing__feed-chrome">
          {olderCursor ? (
            <button
              type="button"
              className="btn-text clearing__load-older"
              onClick={() => void loadOlder()}
              disabled={loadingOlder}
            >
              {loadingOlder ? "[ … ]" : "[ LOAD OLDER ]"}
            </button>
          ) : null}
          {unseenCount > 0 ? (
            <button
              type="button"
              className="btn-text clearing__new"
              onClick={jumpToNew}
            >
              [ NEW IN THE CLEARING ]
            </button>
          ) : null}
        </div>

        <div
          className="clearing__feed"
          ref={feedScrollRef}
          onScroll={onFeedScroll}
          role="log"
          aria-label="Clearing conversation"
          aria-relevant="additions"
          aria-busy={feedLoading}
        >
          {feedLoading && messages.length === 0 ? (
            <p className="muted clearing__listening">
              LISTENING TO THE CLEARING...
            </p>
          ) : null}

          {feedError && messages.length === 0 ? (
            <div className="clearing__error" role="alert">
              <p>{feedError}</p>
              <button
                type="button"
                className="btn-text"
                onClick={() => {
                  setFeedError(null);
                  setFeedLoading(true);
                  void fetchFeed({ mode: "replace" })
                    .catch(() =>
                      setFeedError("THE CLEARING COULD NOT BE HEARD."),
                    )
                    .finally(() => setFeedLoading(false));
                }}
              >
                [ TRY AGAIN ]
              </button>
              <p className="muted">
                <Link href="/camp">[ camp ]</Link>
              </p>
            </div>
          ) : null}

          {!feedLoading && !feedError && messages.length === 0 ? (
            <div className="clearing__empty">
              <p>THE CLEARING IS QUIET.</p>
              <p className="muted">Speak if you will.</p>
            </div>
          ) : null}

          <div className="clearing__messages">
            {messages.map((m) => (
              <ClearingFeedItem key={m.id} item={m} />
            ))}
          </div>
          <div ref={bottomRef} className="clearing__anchor" aria-hidden />
        </div>

        <ClearingComposer
          identity={composerIdentity}
          slowModeUntil={slowModeUntil}
          minting={minting}
          mintError={mintError}
          onEnsureTraveller={mintTraveller}
          onAccepted={onAccepted}
          onSpeakBlocked={onSpeakBlocked}
          onSlowMode={onSlowMode}
        />

        {mintError && !traveller && !identityPending && !authenticated ? (
          <p className="clearing-composer__error muted" role="status">
            {mintError}{" "}
            <button
              type="button"
              className="btn-text"
              onClick={() => void mintTraveller()}
            >
              [ TRY AGAIN ]
            </button>
          </p>
        ) : null}
      </div>
    </div>
  );
}
