import { createHash } from "node:crypto";

import {
  FENN_CHUNK_MAX_CHARS,
  FENN_CHUNK_OVERLAP_CHARS,
  FENN_CHUNK_TARGET_CHARS,
  FENN_CHUNKING_VERSION,
  FENN_EMBEDDING_MODEL,
} from "@/lib/memory/index-config";

export type FennMemoryChunkDraft = {
  chunkIndex: number;
  /** Exact retrievable chunk text (whitespace/newlines preserved). */
  content: string;
};

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Parent document content hash (title + body). */
export function hashMemoryDocumentContent(
  title: string | null | undefined,
  content: string,
): string {
  return sha256Hex(`${title ?? ""}\n${content}`);
}

/** Fingerprint covering content + embedding model + chunking version. */
export function memoryIndexFingerprint(input: {
  title: string | null | undefined;
  content: string;
  embeddingModel?: string;
  chunkingVersion?: string;
}): string {
  const model = input.embeddingModel ?? FENN_EMBEDDING_MODEL;
  const version = input.chunkingVersion ?? FENN_CHUNKING_VERSION;
  return sha256Hex(
    `${version}|${model}|${hashMemoryDocumentContent(input.title, input.content)}`,
  );
}

export function hashChunkContent(content: string): string {
  return sha256Hex(content);
}

/**
 * Embedding API input: title context + chunk body.
 * Stored chunk.content remains body-only.
 */
export function buildChunkEmbeddingInput(
  title: string | null | undefined,
  chunkContent: string,
): string {
  const t = (title ?? "").trim();
  if (!t) return chunkContent;
  return `${t}\n\n${chunkContent}`;
}

function splitLongParagraph(paragraph: string, max: number): string[] {
  if (paragraph.length <= max) return [paragraph];

  const parts: string[] = [];
  let start = 0;
  while (start < paragraph.length) {
    let end = Math.min(start + max, paragraph.length);
    if (end < paragraph.length) {
      // Prefer breaking on whitespace near the end.
      const window = paragraph.slice(start, end);
      const breakAt = Math.max(
        window.lastIndexOf("\n"),
        window.lastIndexOf(" "),
      );
      if (breakAt > Math.floor(max * 0.4)) {
        end = start + breakAt;
      }
    }
    const piece = paragraph.slice(start, end);
    if (piece.trim().length > 0) {
      parts.push(piece);
    }
    if (end >= paragraph.length) break;
    const next = Math.max(end - FENN_CHUNK_OVERLAP_CHARS, start + 1);
    start = next;
  }
  return parts.length > 0 ? parts : [paragraph.slice(0, max)];
}

/**
 * Deterministic semantic chunking.
 * Short documents → one chunk. Longer → paragraph-first splits.
 * Preserves internal whitespace/newlines inside each chunk.
 */
export function chunkFennMemoryContent(input: {
  title?: string | null;
  content: string;
  targetChars?: number;
  maxChars?: number;
}): FennMemoryChunkDraft[] {
  const content = input.content;
  if (content.trim().length === 0) {
    return [];
  }

  const max = input.maxChars ?? FENN_CHUNK_MAX_CHARS;
  const target = input.targetChars ?? FENN_CHUNK_TARGET_CHARS;

  if (content.length <= max) {
    return [{ chunkIndex: 0, content }];
  }

  // Split on blank lines (paragraphs) while keeping paragraph text intact.
  const paragraphs = content.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim().length > 0) {
      chunks.push(current);
    }
    current = "";
  };

  for (const raw of paragraphs) {
    const para = raw; // do not trim — preserve leading/trailing spaces inside para
    if (para.trim().length === 0) continue;

    if (para.length > max) {
      flush();
      for (const piece of splitLongParagraph(para, max)) {
        chunks.push(piece);
      }
      continue;
    }

    if (current.length === 0) {
      current = para;
      continue;
    }

    const joined = `${current}\n\n${para}`;
    if (joined.length <= target || joined.length <= max) {
      current = joined;
    } else {
      flush();
      current = para;
    }
  }
  flush();

  if (chunks.length === 0) {
    return [{ chunkIndex: 0, content }];
  }

  return chunks.map((c, i) => ({ chunkIndex: i, content: c }));
}
