/**
 * Stage 3 — reload public fact evidence for Chronicler admission (authorize-time).
 */

import "server-only";

import type { PublicFactEvidence } from "@/lib/agent/public-fact-evidence";
import {
  readCurrentPublicGathering,
  readGreenwoodLeafThreshold,
  readOfficialFennToken,
  readRegisterPublicFacts,
} from "@/lib/agent/public-fact-readers";
import {
  inferStage124CapabilitiesFromBody,
  resolveExecutableLiveCapabilities,
} from "@/lib/agent/live-capability-routing";
import type { Stage124LiveCapability } from "@/lib/agent/stage124-live-capabilities";
import { isChroniclerFactKey } from "@/lib/agent/chronicler-types";
import type { WallCandidate } from "@/lib/agent/chronicler-types";

/**
 * Load trusted public facts relevant to a Wall candidate / perception body.
 * Fail-closed readers; never throws for downstream admission.
 */
export async function loadTrustedFactsForChronicler(input: {
  body: string;
  needsLiveState: string[];
  wallCandidate: unknown;
}): Promise<PublicFactEvidence[]> {
  const caps = new Set<Stage124LiveCapability>();

  for (const c of resolveExecutableLiveCapabilities({
    requested: input.needsLiveState,
    body: input.body,
    inferFromBodyIfEmpty: true,
  })) {
    caps.add(c);
  }
  for (const c of inferStage124CapabilitiesFromBody(input.body)) {
    caps.add(c);
  }

  const candidate = input.wallCandidate as WallCandidate | null;
  if (
    candidate &&
    typeof candidate === "object" &&
    (candidate as WallCandidate).kind === "public_fact" &&
    isChroniclerFactKey((candidate as { factKey?: string }).factKey)
  ) {
    const key = (candidate as { factKey: string }).factKey;
    if (key === "confirmed_outlaw_count" || key === "greenwood_member_count") {
      caps.add("register");
    } else if (key === "greenwood_leaf_threshold") {
      caps.add("greenwood");
    } else if (key === "official_fenn_token") {
      caps.add("token");
    } else if (key === "current_public_gathering") {
      caps.add("gatherings");
    }
  }

  const facts: PublicFactEvidence[] = [];
  const jobs: Array<Promise<PublicFactEvidence[] | PublicFactEvidence>> = [];

  if (caps.has("register")) {
    jobs.push(readRegisterPublicFacts());
  }
  if (caps.has("greenwood")) {
    jobs.push(readGreenwoodLeafThreshold());
  }
  if (caps.has("token")) {
    jobs.push(readOfficialFennToken());
  }
  if (caps.has("gatherings")) {
    jobs.push(readCurrentPublicGathering());
  }

  for (const job of jobs) {
    try {
      const result = await job;
      if (Array.isArray(result)) facts.push(...result);
      else facts.push(result);
    } catch {
      // fail closed: skip broken reader
    }
  }

  return facts;
}
