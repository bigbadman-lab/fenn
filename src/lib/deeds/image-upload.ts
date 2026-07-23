import "server-only";

import { randomUUID } from "node:crypto";

import {
  assertImageRefOwnedBy,
  buildPendingImagePath,
  DEED_EVIDENCE_BUCKET,
  DEED_IMAGE_MAX_BYTES,
  validateDeedImageFile,
  type DeedImageMimeType,
} from "@/lib/deeds/image-evidence";
import { createAdminClient } from "@/lib/supabase/admin";

export const DEED_IMAGE_SIGNED_URL_SECONDS = 5 * 60;

export class DeedImageError extends Error {
  code:
    | "unsupported_mime"
    | "file_too_large"
    | "empty_file"
    | "mime_mismatch"
    | "invalid_image_ref"
    | "image_not_found"
    | "image_already_used"
    | "upload_failed"
    | "sign_failed";
  status: number;

  constructor(
    code: DeedImageError["code"],
    message: string,
    status = 400,
  ) {
    super(message);
    this.name = "DeedImageError";
    this.code = code;
    this.status = status;
  }
}

export async function uploadPendingDeedEvidenceImage(input: {
  profileId: string;
  deedId: string;
  file: File;
}): Promise<{ imageRef: string; mime: DeedImageMimeType; sizeBytes: number }> {
  const sizeBytes = input.file.size;
  if (sizeBytes > DEED_IMAGE_MAX_BYTES) {
    throw new DeedImageError(
      "file_too_large",
      "Image exceeds 5 MB limit",
      413,
    );
  }

  const buffer = new Uint8Array(await input.file.arrayBuffer());
  const validated = validateDeedImageFile({
    mimeReported: input.file.type || "",
    sizeBytes,
    bytes: buffer,
  });

  if (!validated.ok) {
    const status = validated.code === "file_too_large" ? 413 : 400;
    throw new DeedImageError(
      validated.code,
      messageForImageCode(validated.code),
      status,
    );
  }

  const objectId = randomUUID();
  const path = buildPendingImagePath({
    profileId: input.profileId,
    deedId: input.deedId,
    objectId,
    mime: validated.mime,
  });

  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(DEED_EVIDENCE_BUCKET)
    .upload(path, buffer, {
      contentType: validated.mime,
      upsert: false,
    });

  if (error) {
    throw new DeedImageError("upload_failed", "Failed to store image", 500);
  }

  return {
    imageRef: path,
    mime: validated.mime,
    sizeBytes,
  };
}

/**
 * Resolve a client imageRef to a verified canonical storage path for this
 * profile + deed. Rejects foreign paths and missing objects.
 */
export async function resolveVerifiedImagePath(input: {
  profileId: string;
  deedId: string;
  imageRef: string;
}): Promise<string> {
  let parsed;
  try {
    parsed = assertImageRefOwnedBy(
      input.imageRef,
      input.profileId,
      input.deedId,
    );
  } catch {
    throw new DeedImageError(
      "invalid_image_ref",
      "Image reference is invalid",
      400,
    );
  }

  const admin = createAdminClient();

  const { error: downloadError } = await admin.storage
    .from(DEED_EVIDENCE_BUCKET)
    .download(parsed.path);

  if (downloadError) {
    throw new DeedImageError("image_not_found", "Image not found", 404);
  }

  const { data: used, error: usedError } = await admin
    .from("deed_submissions")
    .select("id")
    .eq("evidence_image_path", parsed.path)
    .maybeSingle();

  if (usedError) {
    throw new DeedImageError("upload_failed", "Failed to verify image", 500);
  }
  if (used) {
    throw new DeedImageError(
      "image_already_used",
      "Image already attached to a submission",
      409,
    );
  }

  return parsed.path;
}

/**
 * Create a short-lived signed URL for a storage object that already belongs
 * to a moderated submission (path loaded from DB, never client-supplied).
 */
export async function createDeedEvidenceSignedUrl(
  storagePath: string,
): Promise<{ signedUrl: string; expiresIn: number }> {
  const trimmed = storagePath.trim();
  if (
    !trimmed ||
    trimmed.includes("..") ||
    trimmed.startsWith("/") ||
    !trimmed.startsWith("pending/")
  ) {
    throw new DeedImageError("invalid_image_ref", "Invalid storage path", 400);
  }

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(DEED_EVIDENCE_BUCKET)
    .createSignedUrl(trimmed, DEED_IMAGE_SIGNED_URL_SECONDS);

  if (error || !data?.signedUrl) {
    throw new DeedImageError("sign_failed", "Failed to sign image URL", 500);
  }

  return {
    signedUrl: data.signedUrl,
    expiresIn: DEED_IMAGE_SIGNED_URL_SECONDS,
  };
}

/**
 * Best-effort delete of a pending upload. Orphan cleanup is not required for
 * Stage 6 correctness — unreferenced pending objects may remain until later ops.
 */
export async function bestEffortDeletePendingImage(
  imageRef: string,
): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.storage.from(DEED_EVIDENCE_BUCKET).remove([imageRef]);
  } catch {
    // Cleanup is best-effort and must not affect submission correctness.
  }
}

function messageForImageCode(
  code: "unsupported_mime" | "file_too_large" | "empty_file" | "mime_mismatch",
): string {
  switch (code) {
    case "unsupported_mime":
      return "Unsupported image type";
    case "file_too_large":
      return "Image exceeds 5 MB limit";
    case "empty_file":
      return "Empty image file";
    case "mime_mismatch":
      return "Image type does not match contents";
  }
}
