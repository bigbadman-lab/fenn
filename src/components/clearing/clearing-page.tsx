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
import type {
  SafeClearingFeedItem,
  SafeClearingMessage,
  SafeTravellerIdentity,
} from "@/lib/clearing/dto";
import {
  clearingStateEqual,
  encodeClientFeedCursor,
  filterFeedItems,
  mergeConversationMessages,
  mergePollFeed,
  newestFeedItem,
  newestFirstToConversation,
} from "@/lib/clearing/feed-client";

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

  const [feedItems, setFeedItems] = useState<SafeClearingFeedItem[]>([]);
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
  /** Watermark for incremental poll; ref so poll tick stays stable. */
  const newestWatermarkRef = useRef<string | null>(null);
  /** Skip scroll following for pure no-op merges. */
  const lastFeedTailIdRef = useRef<string | null>(null);
  const forceScrollRef = useRef(false);

  const identityPending =
    !privyReady || (authenticated && (authLoading || !profileResolved));

  const applyRoomState = useCallback(
    (state: { readOnly?: boolean; slowModeSeconds?: number } | undefined) => {
      if (!state) return;
      const next: FeedState = {
        readOnly: Boolean(state.readOnly),
        slowModeSeconds: Math.max(0, Number(state.slowModeSeconds) || 0),
      };
      setClearingState((prev) =>
        clearingStateEqual(prev, next) ? prev : next,
      );
    },
    [],
  );

  const rememberNewest = useCallback((items: SafeClearingFeedItem[]) => {
    const newest = newestFeedItem(items);
    if (!newest) return;
    try {
      newestWatermarkRef.current = encodeClientFeedCursor(
        newest.occurredAt,
        newest.id,
      );
      lastFeedTailIdRef.current = newest.id;
    } catch {
      // Never let watermark encoding bring down the room.
      lastFeedTailIdRef.current = newest.id;
    }
  }, []);

  const applyFeedPayload = useCallback(
    (
      data: {
        items?: unknown[];
        nextCursor?: string | null;
        state?: { readOnly?: boolean; slowModeSeconds?: number };
      },
      mode: "replace" | "merge" | "prepend",
    ): { items: SafeClearingFeedItem[]; changed: boolean } => {
      const page = filterFeedItems(data.items ?? []);
      // API returns newest first; conversation is oldest first.
      const chronological = newestFirstToConversation(page);

      applyRoomState(data.state);

      if (mode === "replace") {
        setFeedItems(chronological);
        setOlderCursor(data.nextCursor ?? null);
        // Outside setState — keep load path away from reactor error boundaries.
        rememberNewest(chronological);
        return { items: chronological, changed: true };
      }

      if (mode === "prepend") {
        setFeedItems((prev) => {
          const next = mergeConversationMessages(prev, chronological);
          queueMicrotask(() => {
            rememberNewest(next);
          });
          return next;
        });
        setOlderCursor(data.nextCursor ?? null);
        return { items: chronological, changed: chronological.length > 0 };
      }

      // Incremental poll merge — preserve array identity when nothing new.
      let changed = false;
      setFeedItems((prev) => {
        const { next, added } = mergePollFeed(prev, chronological);
        if (added.length > 0) {
          changed = true;
          if (!stickToBottomRef.current) {
            setUnseenCount((c) => c + added.length);
          }
          // Side-effect outside pure updater semantics (sync is fine after return
          // is scheduled; microtask keeps setState pure for error isolation).
          queueMicrotask(() => {
            rememberNewest(next);
          });
        }
        return next;
      });
      return { items: chronological, changed };
    },
    [applyRoomState, rememberNewest],
  );

  const fetchFeed = useCallback(
    async (opts: {
      cursor?: string | null;
      /** Incremental poll: only items newer than watermark. */
      since?: string | null;
      mode: "replace" | "merge" | "prepend";
      signal?: AbortSignal;
    }) => {
      const params = new URLSearchParams();
      params.set("limit", String(INITIAL_LIMIT));
      if (opts.cursor) params.set("cursor", opts.cursor);
      if (opts.since) params.set("since", opts.since);

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
      return applyFeedPayload(data, opts.mode);
    },
    [applyFeedPayload],
  );

  // Initial feed load — identity-independent.
  useEffect(() => {
    const ac = new AbortController();
    abortRef.current = ac;
    setFeedLoading(true);
    setFeedError(null);
    void (async () => {
      try {
        await fetchFeed({ mode: "replace", signal: ac.signal });
      } catch {
        if (ac.signal.aborted) return;
        setFeedError("THE CLEARING COULD NOT BE HEARD.");
      } finally {
        if (!ac.signal.aborted) setFeedLoading(false);
      }
    })();
    return () => ac.abort();
  }, [fetchFeed]);

  // Incremental poll while visible
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      if (cancelled || document.visibilityState === "hidden") return;
      if (fetchInFlight.current) return;
      fetchInFlight.current = true;
      try {
        const since = newestWatermarkRef.current;
        await fetchFeed({
          mode: "merge",
          // Without a watermark, fall back to a head page of empty→first fill only.
          // After initial load the watermark is set; empty room polls without since.
          ...(since ? { since } : {}),
        });
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

  const onFeedScroll = useCallback(() => {
    const el = feedScrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < NEAR_BOTTOM_PX;
    if (stickToBottomRef.current) setUnseenCount(0);
  }, []);

  // Scroll: initial stick; only follow when tail grows and user is near bottom.
  useEffect(() => {
    if (feedLoading) return;
    if (feedItems.length === 0) return;

    const tailId = feedItems[feedItems.length - 1]?.id ?? null;

    if (!initialScrollDone.current) {
      initialScrollDone.current = true;
      lastFeedTailIdRef.current = tailId;
      // Instant jump into the living room — no smooth scroll on first paint.
      bottomRef.current?.scrollIntoView({ block: "end" });
      stickToBottomRef.current = true;
      return;
    }

    const force = forceScrollRef.current;
    forceScrollRef.current = false;
    const tailChanged = tailId != null && tailId !== lastFeedTailIdRef.current;
    lastFeedTailIdRef.current = tailId;

    if (!force && !tailChanged) return;
    if (!stickToBottomRef.current && !force) return;

    // Own post: snap. Remote polls: gentle smooth when already near bottom.
    const behavior: ScrollBehavior = force ? "auto" : "smooth";
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: "end", behavior });
    });
  }, [feedItems, feedLoading]);

  /**
   * Lazy mint/resume — only when visitor intends to speak (focus or SPEAK).
   * Never on passive page load.
   */
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
    forceScrollRef.current = true;
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, []);

  const onAccepted = useCallback(
    (message: SafeClearingMessage, messagesRemaining?: number) => {
      // Defensive: never throw into the React tree after a successful post.
      if (
        !message ||
        typeof message.id !== "string" ||
        !message.author ||
        typeof message.author.label !== "string"
      ) {
        return;
      }

      forceScrollRef.current = true;
      stickToBottomRef.current = true;
      setUnseenCount(0);

      // Merge outside the updater first so watermark work cannot throw mid-setState.
      setFeedItems((prev) => {
        const next = mergeConversationMessages(prev, [message]);
        // Defer side effects out of the pure updater contract.
        queueMicrotask(() => {
          rememberNewest(next);
        });
        return next;
      });

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
      // Poll catches concurrent voices; no post-success full refresh.
    },
    [rememberNewest],
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

  const composerIdentity: ComposerIdentity = useMemo(() => {
    // Auth identity resolving — feed is already independent.
    if (identityPending) return { kind: "pending" };
    if (clearingState.readOnly) return { kind: "read_only" };
    if (authenticated && !registered) return { kind: "claim_name" };
    if (authenticated && registered && profile) {
      const alias =
        profile.alias?.trim() ||
        `OUTLAW ${String(profile.outlawNumber).padStart(5, "0")}`;
      return { kind: "outlaw", alias, speaking };
    }
    // Guests: composer usable before mint — create Traveller only on intent.
    if (exhausted || (traveller && traveller.messagesRemaining <= 0)) {
      return { kind: "registration_threshold" };
    }
    if (!traveller) {
      return { kind: "guest" };
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
          {feedLoading && feedItems.length === 0 ? (
            <p className="muted clearing__presence clearing__presence--soft">
              The Clearing is here.
            </p>
          ) : null}

          {feedError && feedItems.length === 0 ? (
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

          {!feedLoading && !feedError && feedItems.length === 0 ? (
            <div className="clearing__empty clearing__presence">
              <p>THE CLEARING IS QUIET.</p>
              <p className="muted">Speak if you will.</p>
            </div>
          ) : null}

          <div className="clearing__messages">
            {feedItems.map((m) => (
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
