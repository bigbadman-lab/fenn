import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { writeAdminAuditLog } from "@/lib/admin/audit";
import { GreenwoodError } from "@/lib/greenwood/errors";
import {
  fireMessageBodyToParagraphs,
  GREENWOOD_FIRE_MESSAGE_FALLBACK,
  GREENWOOD_FIRE_MESSAGE_MAX_CHARS,
  paragraphsToFireMessageBody,
  validateFireMessageBodyInput,
} from "@/lib/greenwood/fire-message";
import type {
  OperatorFireMessage,
  PublishFireMessageResult,
  SafePublishedFireMessage,
} from "@/lib/greenwood/fire-messages/types";
import { assertProfileId } from "@/lib/leaf/validate";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertMessageId(id: string): string {
  const trimmed = id?.trim() ?? "";
  if (!UUID_RE.test(trimmed)) {
    throw new GreenwoodError(
      "greenwood_fire_message_invalid",
      "Invalid message id",
      400,
    );
  }
  return trimmed;
}

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

type MessageRow = {
  id: string;
  body: string;
  status: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  created_by_profile_id: string | null;
  published_by_profile_id: string | null;
};

const OPERATOR_SELECT =
  "id, body, status, published_at, created_at, updated_at, created_by_profile_id, published_by_profile_id";

function previewBody(body: string): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 80) return oneLine;
  return `${oneLine.slice(0, 77)}…`;
}

function toOperatorMessage(row: MessageRow): OperatorFireMessage {
  return {
    id: row.id,
    body: row.body,
    status: row.status as OperatorFireMessage["status"],
    createdAt: row.created_at,
    publishedAt: row.published_at,
    preview: previewBody(row.body),
  };
}

export function validateFireMessageBody(raw: string): string {
  const result = validateFireMessageBodyInput(raw);
  if (!result.ok) {
    throw new GreenwoodError(
      "greenwood_fire_message_invalid",
      result.reason === "too_long"
        ? `Message must be at most ${GREENWOOD_FIRE_MESSAGE_MAX_CHARS} characters`
        : "Message cannot be empty",
      400,
    );
  }
  return result.body;
}

/**
 * Current published FENN SPEAKS body for Greenwood members.
 * Returns null when none exists (caller may apply static fallback).
 */
export async function getCurrentPublishedFireMessage(
  admin?: SupabaseClient,
): Promise<SafePublishedFireMessage | null> {
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("greenwood_fire_messages")
    .select("body, published_at")
    .eq("status", "published")
    .maybeSingle();

  if (error) {
    throw new GreenwoodError(
      "greenwood_fire_message_failed",
      "Failed to load FENN SPEAKS",
      500,
    );
  }
  if (!data) return null;

  const row = data as { body: string; published_at: string | null };
  if (!row.published_at) return null;
  return { body: row.body, publishedAt: row.published_at };
}

/** Member read with static fallback on missing/error. Never throws. */
export async function getFireMessageForMemberDisplay(
  admin?: SupabaseClient,
): Promise<{ body: string; paragraphs: string[]; fromFallback: boolean }> {
  try {
    const current = await getCurrentPublishedFireMessage(admin);
    if (current?.body) {
      const paragraphs = fireMessageBodyToParagraphs(current.body);
      if (paragraphs.length > 0) {
        return {
          body: current.body,
          paragraphs,
          fromFallback: false,
        };
      }
    }
  } catch {
    // fall through to static fallback
  }
  return {
    body: paragraphsToFireMessageBody(GREENWOOD_FIRE_MESSAGE_FALLBACK),
    paragraphs: [...GREENWOOD_FIRE_MESSAGE_FALLBACK],
    fromFallback: true,
  };
}

export async function listOperatorFireMessages(
  limit = 20,
  admin?: SupabaseClient,
): Promise<{
  current: OperatorFireMessage | null;
  recent: OperatorFireMessage[];
}> {
  const db = admin ?? (await defaultAdmin());
  const capped = Math.min(Math.max(1, limit), 50);
  const { data, error } = await db
    .from("greenwood_fire_messages")
    .select(OPERATOR_SELECT)
    .order("created_at", { ascending: false })
    .limit(capped);

  if (error) {
    throw new GreenwoodError(
      "greenwood_fire_message_failed",
      "Failed to list FENN SPEAKS messages",
      500,
    );
  }

  const rows = (data ?? []) as MessageRow[];
  const recent = rows.map(toOperatorMessage);
  const current = recent.find((m) => m.status === "published") ?? null;
  return { current, recent };
}

export async function createFireMessageDraft(
  body: string,
  actorProfileId: string,
  actorId: string,
  admin?: SupabaseClient,
): Promise<OperatorFireMessage> {
  const db = admin ?? (await defaultAdmin());
  const profileId = assertProfileId(actorProfileId);
  const validated = validateFireMessageBody(body);

  const { data, error } = await db
    .from("greenwood_fire_messages")
    .insert({
      body: validated,
      status: "draft",
      created_by_profile_id: profileId,
    })
    .select(OPERATOR_SELECT)
    .single();

  if (error || !data) {
    throw new GreenwoodError(
      "greenwood_fire_message_failed",
      "Failed to create draft",
      500,
    );
  }

  const message = toOperatorMessage(data as MessageRow);
  await writeAdminAuditLog(db, {
    actorId,
    action: "greenwood.fire_message.create_draft",
    entityType: "greenwood_fire_message",
    entityId: message.id,
    afterState: { status: "draft", preview: message.preview },
  });
  return message;
}

export async function publishFireMessage(
  messageId: string,
  actorProfileId: string,
  actorId: string,
  admin?: SupabaseClient,
): Promise<PublishFireMessageResult> {
  const db = admin ?? (await defaultAdmin());
  const profileId = assertProfileId(actorProfileId);
  const id = assertMessageId(messageId);

  const { data: before } = await db
    .from("greenwood_fire_messages")
    .select("id, status, body")
    .eq("id", id)
    .maybeSingle();

  const { data, error } = await db.rpc("publish_greenwood_fire_message", {
    p_message_id: id,
    p_actor_profile_id: profileId,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("FENN_FIRE_MESSAGE_NOT_FOUND")) {
      throw new GreenwoodError(
        "greenwood_fire_message_not_found",
        "Message not found",
        404,
      );
    }
    if (msg.includes("FENN_FIRE_MESSAGE_NOT_DRAFT")) {
      throw new GreenwoodError(
        "greenwood_fire_message_forbidden",
        "Only drafts may be published",
        409,
      );
    }
    throw new GreenwoodError(
      "greenwood_fire_message_failed",
      "Failed to publish message",
      500,
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { status: string; message_id: string; published_at: string }
    | undefined;

  if (!row?.message_id || !row.published_at) {
    throw new GreenwoodError(
      "greenwood_fire_message_failed",
      "Publish returned incomplete result",
      500,
    );
  }

  const resultStatus =
    row.status === "already_published" ? "already_published" : "published";

  if (resultStatus === "published") {
    await writeAdminAuditLog(db, {
      actorId,
      action: "greenwood.fire_message.publish",
      entityType: "greenwood_fire_message",
      entityId: row.message_id,
      beforeState: before
        ? { status: (before as { status: string }).status }
        : null,
      afterState: {
        status: "published",
        publishedAt: row.published_at,
      },
    });
  }

  return {
    status: resultStatus,
    messageId: row.message_id,
    publishedAt: row.published_at,
  };
}

export async function archiveFireMessageDraft(
  messageId: string,
  actorProfileId: string,
  actorId: string,
  admin?: SupabaseClient,
): Promise<OperatorFireMessage> {
  const db = admin ?? (await defaultAdmin());
  assertProfileId(actorProfileId);
  const id = assertMessageId(messageId);

  const { data: existing, error: loadError } = await db
    .from("greenwood_fire_messages")
    .select(OPERATOR_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    throw new GreenwoodError(
      "greenwood_fire_message_failed",
      "Failed to load draft",
      500,
    );
  }
  if (!existing) {
    throw new GreenwoodError(
      "greenwood_fire_message_not_found",
      "Message not found",
      404,
    );
  }

  const row = existing as MessageRow;
  if (row.status === "archived") {
    return toOperatorMessage(row);
  }
  if (row.status !== "draft") {
    throw new GreenwoodError(
      "greenwood_fire_message_forbidden",
      "Only unpublished drafts may be archived this way",
      409,
    );
  }

  const { data, error } = await db
    .from("greenwood_fire_messages")
    .update({ status: "archived" })
    .eq("id", id)
    .eq("status", "draft")
    .select(OPERATOR_SELECT)
    .maybeSingle();

  if (error || !data) {
    throw new GreenwoodError(
      "greenwood_fire_message_failed",
      "Failed to archive draft",
      500,
    );
  }

  const message = toOperatorMessage(data as MessageRow);
  await writeAdminAuditLog(db, {
    actorId,
    action: "greenwood.fire_message.archive_draft",
    entityType: "greenwood_fire_message",
    entityId: message.id,
    beforeState: { status: "draft" },
    afterState: { status: "archived" },
  });
  return message;
}
