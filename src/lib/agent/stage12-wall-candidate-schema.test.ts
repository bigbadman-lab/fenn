/**
 * Assert Stage 12.3 / 12.4 response_format JSON Schemas are OpenAI strict-compatible
 * for wallCandidate (no empty {} branches from z.unknown()).
 * Network-free: only inspects zodResponseFormat output.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zodResponseFormat } from "openai/helpers/zod";

import { stage12JudgementModelSchema } from "@/lib/agent/judge-schema";
import { stage124FinalJudgementModelSchema } from "@/lib/agent/stage124-final-judgement-schema";
import { sanitizeHarnessProviderFailure } from "@/lib/agent/p1b-harness-provider-error";

type JsonSchemaNode = {
  type?: string | string[];
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  const?: unknown;
  default?: unknown;
  $ref?: string;
  [key: string]: unknown;
};

function extractJsonSchema(rf: unknown): JsonSchemaNode {
  const asRf = rf as {
    json_schema?: { schema?: JsonSchemaNode; strict?: boolean };
  };
  assert.ok(asRf.json_schema?.schema, "missing json_schema.schema");
  return asRf.json_schema.schema;
}

/** No empty objects under the tree that lack type / $ref / anyOf / oneOf / properties */
function assertNoEmptyAnonymousObject(node: JsonSchemaNode, path: string): void {
  if (node == null || typeof node !== "object") return;

  const keys = Object.keys(node).filter((k) => k !== "description" && k !== "title");
  if (keys.length === 0) {
    assert.fail(`empty {} schema at ${path}`);
  }

  // Bare object with only untyped junk is still bad for OpenAI if no type/$ref/anyOf
  if (
    !node.type &&
    !node.$ref &&
    !node.anyOf &&
    !node.oneOf &&
    !node.properties &&
    node.const === undefined &&
    node.default === undefined &&
    !Array.isArray(node.enum)
  ) {
    // allow definitions root etc.
    const hasOnlyMeta = keys.every((k) =>
      ["description", "title", "default"].includes(k),
    );
    if (hasOnlyMeta || keys.length === 0) {
      assert.fail(`schema missing type at ${path}: ${JSON.stringify(node)}`);
    }
  }

  if (Array.isArray(node.anyOf)) {
    node.anyOf.forEach((child, i) =>
      assertNoEmptyAnonymousObject(child, `${path}.anyOf[${i}]`),
    );
  }
  if (Array.isArray(node.oneOf)) {
    node.oneOf.forEach((child, i) =>
      assertNoEmptyAnonymousObject(child, `${path}.oneOf[${i}]`),
    );
  }
  if (node.properties) {
    for (const [k, child] of Object.entries(node.properties)) {
      assertNoEmptyAnonymousObject(child, `${path}.properties.${k}`);
    }
  }
  if (node.$defs && typeof node.$defs === "object") {
    for (const [k, child] of Object.entries(
      node.$defs as Record<string, JsonSchemaNode>,
    )) {
      assertNoEmptyAnonymousObject(child, `${path}.$defs.${k}`);
    }
  }
  if (node.definitions && typeof node.definitions === "object") {
    for (const [k, child] of Object.entries(
      node.definitions as Record<string, JsonSchemaNode>,
    )) {
      assertNoEmptyAnonymousObject(child, `${path}.definitions.${k}`);
    }
  }
}

function assertWallCandidateStrict(node: JsonSchemaNode | undefined, label: string) {
  assert.ok(node, `${label}: wallCandidate missing`);
  assertNoEmptyAnonymousObject(node, `${label}.wallCandidate`);

  // Must not be the old z.unknown() shape: anyOf: [{}, {type:null}]
  const branches = node.anyOf ?? node.oneOf ?? null;
  if (branches) {
    for (const [i, b] of branches.entries()) {
      const keys = Object.keys(b);
      assert.ok(
        b.type || b.$ref || b.const !== undefined || b.anyOf || b.oneOf || b.properties,
        `${label}: wallCandidate branch ${i} must have type ($ref/const/object)`,
      );
      assert.notEqual(JSON.stringify(b), "{}", `${label}: empty branch`);
      void keys;
    }
  } else {
    assert.ok(
      node.type || node.$ref,
      `${label}: wallCandidate must declare type or $ref`,
    );
  }
}

describe("Stage 12 wallCandidate OpenAI strict schema", () => {
  it("Stage 12.4 final judgement schema has typed wallCandidate (no empty {})", () => {
    const rf = zodResponseFormat(
      stage124FinalJudgementModelSchema,
      "fenn_public_final_judgement",
    );
    const schema = extractJsonSchema(rf);
    assert.equal((rf as { json_schema?: { strict?: boolean } }).json_schema?.strict, true);
    assert.ok(schema.properties?.wallCandidate);
    assertWallCandidateStrict(schema.properties?.wallCandidate, "stage124");
    assertNoEmptyAnonymousObject(
      schema.properties!.wallCandidate!,
      "stage124.wallCandidate",
    );
    // economicAction remains present (semantics unchanged)
    assert.ok(schema.properties?.economicAction);
  });

  it("Stage 12.3 initial judgement schema has typed wallCandidate (no empty {})", () => {
    const rf = zodResponseFormat(
      stage12JudgementModelSchema,
      "fenn_public_judgement",
    );
    const schema = extractJsonSchema(rf);
    assertWallCandidateStrict(schema.properties?.wallCandidate, "stage123");
    assertNoEmptyAnonymousObject(
      schema.properties!.wallCandidate!,
      "stage123.wallCandidate",
    );
  });

  it("accepts explicit wallCandidate parse shapes used by model", () => {
    const ok = stage124FinalJudgementModelSchema.parse({
      engage: true,
      action: "reply_on_x",
      reasonCode: "answered_from_public_knowledge",
      replyText: "Hi.",
      wallBody: null,
      identityUnverified: false,
      wallCandidate: null,
      economicAction: "NONE",
    });
    assert.equal(ok.wallCandidate, null);
    assert.equal(ok.economicAction, "NONE");

    const withWall = stage124FinalJudgementModelSchema.parse({
      engage: true,
      action: "reply_and_write_to_wall",
      reasonCode: "answered_from_public_knowledge",
      replyText: "Hi.",
      wallBody: "A law.",
      identityUnverified: false,
      wallCandidate: {
        kind: "declaration",
        declarationKey: "test-key",
        reason: "constitutional_declaration",
      },
      economicAction: "NONE",
    });
    assert.equal(withWall.wallCandidate?.kind, "declaration");
  });

  it("harness provider sanitizer redacts secret-like strings", () => {
    const dig = sanitizeHarnessProviderFailure({
      status: 400,
      message: "400 Invalid schema sk-abc123TOKEN and Bearer tok",
      error: {
        message: "schema must have a 'type' key for wallCandidate",
      },
    });
    assert.equal(dig.stage, "openai_structured_request");
    assert.equal(dig.status, 400);
    assert.doesNotMatch(dig.message, /sk-[a-zA-Z0-9]/);
    assert.doesNotMatch(dig.message, /Bearer\s+\S+/i);
  });
});
