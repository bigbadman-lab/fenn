/**
 * Conceptual Stage 12 agent actions (not executed in Stage 11.7).
 *
 * Wall prose / ASCII is content passed to write_to_wall — not a separate tool.
 */

export const STAGE12_AGENT_ACTIONS = [
  "reply_on_x",
  "write_to_wall",
  "reply_and_write_to_wall",
  "do_nothing",
] as const;

export type Stage12AgentAction = (typeof STAGE12_AGENT_ACTIONS)[number];

/**
 * X users never invoke tools.
 * Content is input → FENN reasons → FENN may choose an allowed action →
 * policy/safety → trusted application tool.
 */
export const STAGE12_USER_CONTENT_IS_NOT_A_TOOL_INVOCATION = true as const;
