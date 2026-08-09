/**
 * Optional local env bootstrap for ops CLIs.
 * Loads `.env.local` when present; never overwrites existing process.env
 * (Render / CI / shell exports win). Never logs secret values.
 *
 * Laws:
 * - Valid (non-blank) process.env values always win over file values.
 * - File may only fill keys that are missing or blank.
 * - File must never write blank values into process.env.
 * - Absent `.env.local` is a pure no-op (Render does not need a file).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type LoadLocalEnvResult = {
  loaded: boolean;
  path: string | null;
  keysSet: number;
};

function isEnvValuePresent(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Parse a single dotenv-style line. Supports optional single/double quotes.
 * Does not expand variables. Skips comments and blank lines.
 */
export function parseEnvLine(
  line: string,
): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const eq = trimmed.indexOf("=");
  if (eq <= 0) return null;

  const key = trimmed.slice(0, eq).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

/**
 * If `.env.local` exists under cwd, apply unset/blank keys into process.env.
 * Safe to call multiple times. No-op when the file is absent (Render).
 */
export function loadLocalEnvIfPresent(options?: {
  cwd?: string;
  filename?: string;
  env?: NodeJS.ProcessEnv;
}): LoadLocalEnvResult {
  const cwd = options?.cwd ?? process.cwd();
  const filename = options?.filename ?? ".env.local";
  // Always mutate the live process env for the default path — never a fresh {}.
  const env = options?.env ?? process.env;
  const path = join(cwd, filename);

  if (!existsSync(path)) {
    return { loaded: false, path: null, keysSet: 0 };
  }

  const content = readFileSync(path, "utf8");
  let keysSet = 0;

  for (const line of content.split(/\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    // Process wins: non-blank existing values are never replaced by the file.
    if (isEnvValuePresent(env[parsed.key])) continue;
    // Never inject blanks (would mark required keys present-as-empty incorrectly).
    if (!isEnvValuePresent(parsed.value)) continue;
    env[parsed.key] = parsed.value;
    keysSet += 1;
  }

  return { loaded: true, path, keysSet };
}
