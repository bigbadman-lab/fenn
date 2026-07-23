/**
 * Pure image-evidence helpers for Stage 6.5.
 * Path ownership checks are deterministic; Storage I/O lives in image-upload.ts.
 */

export const DEED_EVIDENCE_BUCKET = "deed-evidence";

export const DEED_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MiB

export const DEED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type DeedImageMimeType = (typeof DEED_IMAGE_MIME_TYPES)[number];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EXT_BY_MIME: Record<DeedImageMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MIME_BY_EXT: Record<string, DeedImageMimeType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export type PendingImagePathParts = {
  profileId: string;
  deedId: string;
  objectId: string;
  ext: string;
  path: string;
};

export function isAllowedDeedImageMime(
  value: string,
): value is DeedImageMimeType {
  return (DEED_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export function extensionForDeedImageMime(mime: DeedImageMimeType): string {
  return EXT_BY_MIME[mime];
}

/**
 * Build canonical pending upload path:
 * pending/<profileId>/<deedId>/<uuid>.<ext>
 */
export function buildPendingImagePath(input: {
  profileId: string;
  deedId: string;
  objectId: string;
  mime: DeedImageMimeType;
}): string {
  const profileId = input.profileId.trim();
  const deedId = input.deedId.trim();
  const objectId = input.objectId.trim();
  if (!UUID_RE.test(profileId) || !UUID_RE.test(deedId) || !UUID_RE.test(objectId)) {
    throw new Error("Invalid uuid in image path components");
  }
  const ext = extensionForDeedImageMime(input.mime);
  return `pending/${profileId}/${deedId}/${objectId}.${ext}`;
}

/**
 * Parse and validate a pending image path. Rejects path traversal / foreign prefixes.
 */
export function parsePendingImagePath(
  path: string,
): PendingImagePathParts | null {
  const trimmed = path.trim();
  if (!trimmed || trimmed.includes("..") || trimmed.startsWith("/")) {
    return null;
  }

  const match = /^pending\/([^/]+)\/([^/]+)\/([^/]+)\.([a-z0-9]+)$/i.exec(
    trimmed,
  );
  if (!match) return null;

  const [, profileId, deedId, objectId, extRaw] = match;
  const ext = extRaw.toLowerCase();
  if (!UUID_RE.test(profileId) || !UUID_RE.test(deedId) || !UUID_RE.test(objectId)) {
    return null;
  }
  if (!(ext in MIME_BY_EXT)) return null;

  return {
    profileId,
    deedId,
    objectId,
    ext,
    path: `pending/${profileId}/${deedId}/${objectId}.${ext}`,
  };
}

export function assertImageRefOwnedBy(
  imageRef: string,
  profileId: string,
  deedId: string,
): PendingImagePathParts {
  const parsed = parsePendingImagePath(imageRef);
  if (!parsed) {
    throw new Error("invalid_image_ref");
  }
  if (parsed.profileId !== profileId.trim() || parsed.deedId !== deedId.trim()) {
    throw new Error("invalid_image_ref");
  }
  return parsed;
}

/** Lightweight magic-byte check; not a full image parser. */
export function detectDeedImageMimeFromBytes(
  bytes: Uint8Array,
): DeedImageMimeType | null {
  if (bytes.length < 12) return null;

  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }

  // WEBP: RIFF....WEBP
  const riff =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46;
  const webp =
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;
  if (riff && webp) return "image/webp";

  return null;
}

export function validateDeedImageFile(input: {
  mimeReported: string;
  sizeBytes: number;
  bytes: Uint8Array;
}):
  | { ok: true; mime: DeedImageMimeType }
  | { ok: false; code: "unsupported_mime" | "file_too_large" | "empty_file" | "mime_mismatch" } {
  if (input.sizeBytes <= 0 || input.bytes.length === 0) {
    return { ok: false, code: "empty_file" };
  }
  if (input.sizeBytes > DEED_IMAGE_MAX_BYTES) {
    return { ok: false, code: "file_too_large" };
  }

  const reported = input.mimeReported.trim().toLowerCase();
  // Explicit SVG reject even if mislabeled.
  if (
    reported === "image/svg+xml" ||
    reported.includes("svg")
  ) {
    return { ok: false, code: "unsupported_mime" };
  }

  const detected = detectDeedImageMimeFromBytes(input.bytes);
  if (!detected) {
    return { ok: false, code: "unsupported_mime" };
  }

  if (!isAllowedDeedImageMime(reported)) {
    return { ok: false, code: "unsupported_mime" };
  }

  if (reported !== detected) {
    // Allow image/jpg alias only if we mapped — we don't; require exact match.
    return { ok: false, code: "mime_mismatch" };
  }

  return { ok: true, mime: detected };
}
