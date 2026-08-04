/**
 * Stage 12 agent actions for live X-originated intentions.
 *
 * Effect types remain reply_on_x / write_to_wall on x_perception_effects.
 * Wall-only is not a valid *new* autonomous action from X conversation —
 * inscription always requires a accompanying X reply (reply_and_write_to_wall).
 *
 * Historical judgements may still store final_action = write_to_wall.
 * Desk Wall test may still build wall-only effects behind an ops flag.
 */

/** Actions the model may emit for live X perception judgements. */
export const STAGE12_LIVE_AGENT_ACTIONS = [
  "do_nothing",
  "reply_on_x",
  "reply_and_write_to_wall",
] as const;

export type Stage12LiveAgentAction =
  (typeof STAGE12_LIVE_AGENT_ACTIONS)[number];

/**
 * @deprecated Prefer STAGE12_LIVE_AGENT_ACTIONS for new code.
 * Alias kept for tests and imports that mean “current model actions”.
 */
export const STAGE12_AGENT_ACTIONS = STAGE12_LIVE_AGENT_ACTIONS;

export type Stage12AgentAction = Stage12LiveAgentAction;

/**
 * Legacy wall-only intention (historical DB + Desk synthetic scaffold).
 * Not accepted from live model output schemas.
 */
export const STAGE12_LEGACY_WALL_ONLY_ACTION = "write_to_wall" as const;

/** All action strings that may appear in DB history. */
export const STAGE12_KNOWN_AGENT_ACTIONS = [
  ...STAGE12_LIVE_AGENT_ACTIONS,
  STAGE12_LEGACY_WALL_ONLY_ACTION,
] as const;

export type Stage12KnownAgentAction =
  (typeof STAGE12_KNOWN_AGENT_ACTIONS)[number];

/**
 * X users never invoke tools.
 * Content is input → FENN reasons → FENN may choose an allowed action →
 * policy/safety → trusted application tool.
 */
export const STAGE12_USER_CONTENT_IS_NOT_A_TOOL_INVOCATION = true as const;

export function isStage12LiveAgentAction(
  value: string,
): value is Stage12LiveAgentAction {
  return (STAGE12_LIVE_AGENT_ACTIONS as readonly string[]).includes(value);
}

export function isStage12KnownAgentAction(
  value: string,
): value is Stage12KnownAgentAction {
  return (STAGE12_KNOWN_AGENT_ACTIONS as readonly string[]).includes(value);
}
