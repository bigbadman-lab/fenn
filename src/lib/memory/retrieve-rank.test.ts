import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FENN_RETRIEVE_CANON_AUTHORITY_BOOST,
  FENN_RETRIEVE_LEXICAL_WEIGHT,
  FENN_RETRIEVE_MIN_HYBRID_SCORE,
  FENN_RETRIEVE_SEMANTIC_WEIGHT,
} from "@/lib/memory/retrieve-config";
import {
  cosineDistanceToSimilarity,
  hybridScore,
  lexicalOverlapScore,
  rankRetrieveCandidates,
  type RankableCandidate,
} from "@/lib/memory/retrieve-rank";

function candidate(
  partial: Partial<RankableCandidate> &
    Pick<RankableCandidate, "memoryId" | "layer" | "text" | "cosineDistance">,
): RankableCandidate {
  return {
    title: "Title",
    chunkIndex: 0,
    visibility: "public",
    ...partial,
  };
}

describe("retrieve ranking math", () => {
  it("converts cosine distance to bounded similarity", () => {
    assert.equal(cosineDistanceToSimilarity(0), 1);
    assert.equal(cosineDistanceToSimilarity(0.25), 0.75);
    assert.equal(cosineDistanceToSimilarity(2), 0);
  });

  it("lexical overlap rewards exact FENN terminology", () => {
    const score = lexicalOverlapScore(
      "What is LEAF?",
      "LEAF",
      "LEAF is the standing unit of FENN.",
    );
    assert.ok(score >= 0.5);
    const weak = lexicalOverlapScore(
      "What is LEAF?",
      "Camp greeting",
      "hello there friend",
    );
    assert.ok(weak < score);
  });

  it("Canon authority boost is modest and additive", () => {
    const canon = hybridScore({
      semanticScore: 0.8,
      lexicalScore: 0.5,
      layer: "canon",
    });
    const memory = hybridScore({
      semanticScore: 0.8,
      lexicalScore: 0.5,
      layer: "greenwood_memory",
    });
    assert.ok(
      Math.abs(
        canon -
          memory -
          FENN_RETRIEVE_CANON_AUTHORITY_BOOST,
      ) < 1e-9,
    );
    assert.equal(
      canon,
      0.8 * FENN_RETRIEVE_SEMANTIC_WEIGHT +
        0.5 * FENN_RETRIEVE_LEXICAL_WEIGHT +
        FENN_RETRIEVE_CANON_AUTHORITY_BOOST,
    );
  });

  it("strongly relevant Canon outranks similarly relevant memory", () => {
    const ranked = rankRetrieveCandidates({
      query: "What is LEAF?",
      limit: 5,
      minScore: 0,
      candidates: [
        candidate({
          memoryId: "mem",
          layer: "greenwood_memory",
          title: "LEAF note",
          text: "LEAF is the standing unit.",
          cosineDistance: 0.15,
        }),
        candidate({
          memoryId: "can",
          layer: "canon",
          title: "LEAF",
          text: "LEAF is the standing unit of FENN.",
          cosineDistance: 0.15,
        }),
      ],
    });
    assert.equal(ranked[0]?.memoryId, "can");
    assert.ok((ranked[0]?.score ?? 0) > (ranked[1]?.score ?? 0));
  });

  it("strongly relevant memory can outrank irrelevant Canon", () => {
    const ranked = rankRetrieveCandidates({
      query: "persistence at Camp",
      limit: 5,
      minScore: 0,
      candidates: [
        candidate({
          memoryId: "can",
          layer: "canon",
          title: "Treasury",
          text: "Treasury holds protocol funds.",
          cosineDistance: 0.85,
        }),
        candidate({
          memoryId: "mem",
          layer: "greenwood_memory",
          title: "Persistence",
          text: "Camp speakers value persistence over novelty.",
          cosineDistance: 0.12,
        }),
      ],
    });
    assert.equal(ranked[0]?.memoryId, "mem");
  });

  it("omits results below hybrid threshold", () => {
    const ranked = rankRetrieveCandidates({
      query: "zzz unrelated",
      limit: 5,
      candidates: [
        candidate({
          memoryId: "can",
          layer: "canon",
          text: "Something distant",
          cosineDistance: 0.95,
        }),
      ],
    });
    assert.equal(ranked.length, 0);
    assert.ok(FENN_RETRIEVE_MIN_HYBRID_SCORE > 0);
  });

  it("caps chunks per memory and final limit deterministically", () => {
    const ranked = rankRetrieveCandidates({
      query: "Greenwood",
      limit: 3,
      minScore: 0,
      maxChunksPerMemory: 2,
      candidates: [
        candidate({
          memoryId: "a",
          layer: "canon",
          text: "Greenwood one",
          chunkIndex: 0,
          cosineDistance: 0.1,
        }),
        candidate({
          memoryId: "a",
          layer: "canon",
          text: "Greenwood two",
          chunkIndex: 1,
          cosineDistance: 0.11,
        }),
        candidate({
          memoryId: "a",
          layer: "canon",
          text: "Greenwood three",
          chunkIndex: 2,
          cosineDistance: 0.12,
        }),
        candidate({
          memoryId: "b",
          layer: "canon",
          text: "Greenwood other",
          chunkIndex: 0,
          cosineDistance: 0.13,
        }),
        candidate({
          memoryId: "c",
          layer: "canon",
          text: "Greenwood third doc",
          chunkIndex: 0,
          cosineDistance: 0.14,
        }),
      ],
    });
    assert.equal(ranked.length, 3);
    assert.equal(ranked.filter((r) => r.memoryId === "a").length, 2);
    assert.equal(ranked[2]?.memoryId, "b");
  });
});
