import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildChunkEmbeddingInput,
  chunkFennMemoryContent,
  hashChunkContent,
  memoryIndexFingerprint,
} from "@/lib/memory/chunking";
import {
  FENN_CHUNK_MAX_CHARS,
  FENN_CHUNKING_VERSION,
  FENN_EMBEDDING_MODEL,
} from "@/lib/memory/index-config";

describe("chunkFennMemoryContent", () => {
  it("keeps short documents as one chunk", () => {
    const content = "A short Canon line.\n\nStill one document.";
    const chunks = chunkFennMemoryContent({ content });
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]?.chunkIndex, 0);
    assert.equal(chunks[0]?.content, content);
  });

  it("splits long content on paragraph boundaries deterministically", () => {
    const paragraphs = Array.from({ length: 8 }, (_, i) =>
      `Paragraph ${i + 1}. ${"word ".repeat(40)}`.trim(),
    );
    const content = paragraphs.join("\n\n");
    assert.ok(content.length > FENN_CHUNK_MAX_CHARS);

    const a = chunkFennMemoryContent({ content });
    const b = chunkFennMemoryContent({ content });
    assert.deepEqual(a, b);
    assert.ok(a.length > 1);
    assert.ok(a.every((c) => c.content.trim().length > 0));
    assert.deepEqual(
      a.map((c) => c.chunkIndex),
      a.map((_, i) => i),
    );
    // No empty / duplicate accidental chunks
    assert.equal(new Set(a.map((c) => c.content)).size, a.length);
  });

  it("preserves ASCII newlines and spacing inside chunks", () => {
    const ascii = "line one\n  indented\n    /\\\n   /  \\\n";
    const chunks = chunkFennMemoryContent({ content: ascii });
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]?.content, ascii);
    assert.match(chunks[0]?.content ?? "", /  indented/);
  });

  it("handles a very long single paragraph safely", () => {
    const content = "x".repeat(FENN_CHUNK_MAX_CHARS * 3 + 50);
    const chunks = chunkFennMemoryContent({ content });
    assert.ok(chunks.length >= 3);
    assert.ok(chunks.every((c) => c.content.length <= FENN_CHUNK_MAX_CHARS));
    assert.ok(chunks.every((c) => c.content.length > 0));
  });

  it("embedding input may include title without altering stored content", () => {
    const content = "body only";
    const chunks = chunkFennMemoryContent({ title: "Title", content });
    assert.equal(chunks[0]?.content, content);
    assert.equal(
      buildChunkEmbeddingInput("Title", content),
      "Title\n\nbody only",
    );
  });

  it("fingerprints change when content or model/version would change", () => {
    const a = memoryIndexFingerprint({ title: "t", content: "c" });
    const b = memoryIndexFingerprint({ title: "t", content: "c2" });
    assert.notEqual(a, b);
    assert.equal(
      memoryIndexFingerprint({ title: "t", content: "c" }),
      memoryIndexFingerprint({ title: "t", content: "c" }),
    );
    assert.match(hashChunkContent("hello"), /^[a-f0-9]{64}$/);
    assert.equal(FENN_EMBEDDING_MODEL, "text-embedding-3-small");
    assert.equal(FENN_CHUNKING_VERSION, "chunk-v1");
  });
});
