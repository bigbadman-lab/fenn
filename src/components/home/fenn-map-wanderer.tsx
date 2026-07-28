"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";

import { fennMapAscii, type FennAsciiPose } from "@/content/fenn-ascii";
import {
  atmosphericLineFor,
  cellToPoint,
  chooseNextDestination,
  FENN_GREENWOOD_LINGER_MS_MAX,
  FENN_GREENWOOD_LINGER_MS_MIN,
  FENN_IDLE_FOOTPRINT,
  FENN_IDLE_MS_MAX,
  FENN_IDLE_MS_MIN,
  FENN_MAP_CELLS,
  FENN_TRAVEL_FOOTPRINT,
  FENN_WALK_STEP_MS,
  isGreenwoodSpecialVisit,
  mulberry32,
  pathBetweenWaypoints,
  pickBoundedMs,
  pickNeighbor,
  shouldRunWanderTimers,
  type FennAtmosphericLine,
  type FennMapCell,
  type FennMapPoint,
  type FennMapVariant,
  type FennMapWaypointId,
  type FennWanderPhase,
} from "@/lib/home/fenn-map-path";

type Props = {
  variant: FennMapVariant;
};

type WanderState = {
  at: FennMapWaypointId;
  phase: FennWanderPhase;
  pos: FennMapPoint;
  pose: FennAsciiPose;
  line: FennAtmosphericLine;
};

function pointForCell(
  variant: FennMapVariant,
  cell: FennMapCell,
  idle: boolean,
): FennMapPoint {
  return cellToPoint(
    variant,
    cell,
    idle ? FENN_IDLE_FOOTPRINT[variant] : FENN_TRAVEL_FOOTPRINT[variant],
  );
}

function initialState(variant: FennMapVariant): WanderState {
  const at: FennMapWaypointId = "camp";
  return {
    at,
    phase: "idle",
    pos: pointForCell(variant, FENN_MAP_CELLS[variant][at], true),
    pose: "a",
    line: "FENN waits.",
  };
}

function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/**
 * Atmospheric FENN inhabiting the homepage map.
 * Walks only through empty ASCII cells — never covers landmarks.
 */
export function FennMapWanderer({ variant }: Props) {
  const hydrated = useIsClient();
  const [state, setState] = useState(() => initialState(variant));
  const [reduceMotion, setReduceMotion] = useState(false);
  const [visible, setVisible] = useState(true);
  const [layoutActive, setLayoutActive] = useState(variant === "desktop");
  const randRef = useRef<() => number>(() => 0.5);
  const timersRef = useRef<number[]>([]);
  const atRef = useRef<FennMapWaypointId>("camp");
  const seedReady = useRef(false);

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) {
      window.clearTimeout(id);
    }
    timersRef.current = [];
  }, []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timersRef.current.push(id);
  }, []);

  useEffect(() => {
    if (!seedReady.current) {
      seedReady.current = true;
      randRef.current = mulberry32(
        (Date.now() ^ (Math.floor(Math.random() * 0xffff) << 8)) >>> 0,
      );
    }

    const motionMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applyMotion = () => setReduceMotion(motionMq.matches);
    applyMotion();
    motionMq.addEventListener("change", applyMotion);

    const layoutMq = window.matchMedia("(max-width: 40rem)");
    const applyLayout = () =>
      setLayoutActive(
        variant === "mobile" ? layoutMq.matches : !layoutMq.matches,
      );
    applyLayout();
    layoutMq.addEventListener("change", applyLayout);

    const applyVisibility = () =>
      setVisible(document.visibilityState === "visible");
    applyVisibility();
    document.addEventListener("visibilitychange", applyVisibility);

    return () => {
      motionMq.removeEventListener("change", applyMotion);
      layoutMq.removeEventListener("change", applyLayout);
      document.removeEventListener("visibilitychange", applyVisibility);
      clearTimers();
    };
  }, [clearTimers, variant]);

  useEffect(() => {
    if (!hydrated) return;
    clearTimers();

    if (
      !layoutActive ||
      !shouldRunWanderTimers({ documentVisible: visible, reduceMotion })
    ) {
      const settled =
        atRef.current === "greenwood_gate" ? "greenwood" : atRef.current;
      atRef.current = settled;
      setState({
        at: settled,
        phase: "idle",
        pos: pointForCell(variant, FENN_MAP_CELLS[variant][settled], true),
        pose: "a",
        line:
          settled === "greenwood"
            ? "FENN stands at the Greenwood."
            : "FENN waits.",
      });
      return;
    }

    const rand = () => randRef.current();

    const beginWalk = (
      fromId: FennMapWaypointId,
      toId: FennMapWaypointId,
      greenwoodVisit: boolean,
    ) => {
      const path = pathBetweenWaypoints(variant, fromId, toId);
      const approach =
        greenwoodVisit && isGreenwoodSpecialVisit(toId)
          ? ("greenwood_approach" as const)
          : ("walking" as const);

      setState({
        at: fromId,
        phase: approach,
        pos: pointForCell(variant, path[0] ?? FENN_MAP_CELLS[variant][fromId], false),
        pose: "a",
        line: atmosphericLineFor(approach, toId),
      });

      const tick = (stepIndex: number) => {
        if (stepIndex >= path.length) {
          arrive(toId, greenwoodVisit);
          return;
        }
        const cell = path[stepIndex]!;
        setState({
          at: fromId,
          phase: approach,
          pos: pointForCell(variant, cell, false),
          pose: stepIndex % 2 === 0 ? "b" : "a",
          line: atmosphericLineFor(approach, toId),
        });
        schedule(() => tick(stepIndex + 1), FENN_WALK_STEP_MS);
      };

      schedule(() => tick(1), FENN_WALK_STEP_MS);
    };

    const leaveGreenwood = (gateId: FennMapWaypointId) => {
      let next = pickNeighbor(gateId, rand, {
        avoid: gateId === "greenwood" ? "greenwood_gate" : "greenwood",
      });
      if (isGreenwoodSpecialVisit(next)) {
        next = pickNeighbor(gateId, rand, { avoid: "greenwood" });
      }
      if (isGreenwoodSpecialVisit(next)) {
        next = "deeds";
      }
      beginWalk(gateId, next, false);
    };

    const arrive = (toId: FennMapWaypointId, greenwoodVisit: boolean) => {
      if (greenwoodVisit && isGreenwoodSpecialVisit(toId)) {
        const gateId: FennMapWaypointId =
          toId === "greenwood_gate" ? "greenwood_gate" : "greenwood";
        atRef.current = gateId;
        setState({
          at: gateId,
          phase: "greenwood_linger",
          pos: pointForCell(variant, FENN_MAP_CELLS[variant][gateId], true),
          pose: "a",
          line: "FENN stands at the Greenwood.",
        });
        const linger = pickBoundedMs(
          rand,
          FENN_GREENWOOD_LINGER_MS_MIN,
          FENN_GREENWOOD_LINGER_MS_MAX,
        );
        schedule(() => leaveGreenwood(gateId), linger);
        return;
      }

      const settled: FennMapWaypointId =
        toId === "greenwood_gate" ? "greenwood" : toId;
      atRef.current = settled;
      setState({
        at: settled,
        phase: "idle",
        pos: pointForCell(variant, FENN_MAP_CELLS[variant][settled], true),
        pose: "a",
        line: atmosphericLineFor("idle", settled),
      });

      const idleMs = pickBoundedMs(rand, FENN_IDLE_MS_MIN, FENN_IDLE_MS_MAX);
      schedule(() => {
        const choice = chooseNextDestination(settled, rand);
        beginWalk(settled, choice.target, choice.greenwoodVisit);
      }, idleMs);
    };

    const startAt = atRef.current;
    setState({
      at: startAt,
      phase: "idle",
      pos: pointForCell(variant, FENN_MAP_CELLS[variant][startAt], true),
      pose: "a",
      line: atmosphericLineFor("idle", startAt),
    });

    const idleMs = pickBoundedMs(rand, FENN_IDLE_MS_MIN, FENN_IDLE_MS_MAX);
    schedule(() => {
      const choice = chooseNextDestination(startAt, rand);
      beginWalk(startAt, choice.target, choice.greenwoodVisit);
    }, idleMs);

    return clearTimers;
  }, [
    hydrated,
    visible,
    reduceMotion,
    layoutActive,
    variant,
    clearTimers,
    schedule,
  ]);

  const ascii = fennMapAscii(variant, state.pose);
  const showLine =
    state.phase === "greenwood_linger" ||
    state.line === "FENN stands at the Greenwood.";

  return (
    <div
      className={`fenn-map__wanderer fenn-map__wanderer--${variant}`}
      style={
        {
          "--fenn-x": `${state.pos.x}%`,
          "--fenn-y": `${state.pos.y}%`,
        } as CSSProperties
      }
      aria-hidden="true"
      data-fenn-phase={state.phase}
      data-fenn-at={state.at}
    >
      <pre className="ascii fenn-map__wanderer-art">{ascii}</pre>
      {showLine ? (
        <p className="fenn-map__wanderer-line muted">{state.line}</p>
      ) : null}
    </div>
  );
}
