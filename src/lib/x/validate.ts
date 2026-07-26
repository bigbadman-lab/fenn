import { z } from "zod";

import { XError } from "@/lib/x/errors";
import { assertSnowflakeId } from "@/lib/x/snowflake";

/** Digit-string snowflake — never Number. */
const snowflakeString = z
  .string()
  .trim()
  .regex(/^\d+$/, "must be digit string snowflake");

const referencedTweetSchema = z.object({
  type: z.string(),
  id: snowflakeString,
});

const tweetSchema = z.object({
  id: snowflakeString,
  text: z.string().min(1),
  author_id: snowflakeString,
  created_at: z.string().min(1),
  conversation_id: snowflakeString.optional(),
  referenced_tweets: z.array(referencedTweetSchema).optional(),
});

const userSchema = z.object({
  id: snowflakeString,
  username: z.string().min(1),
  name: z.string().optional(),
});

const xErrorBodySchema = z.object({
  title: z.string().optional(),
  detail: z.string().optional(),
  type: z.string().optional(),
  status: z.number().optional(),
});

const mentionsResponseSchema = z.object({
  data: z.array(tweetSchema).optional(),
  includes: z
    .object({
      users: z.array(userSchema).optional(),
    })
    .optional(),
  meta: z
    .object({
      result_count: z.number().optional(),
      newest_id: snowflakeString.optional(),
      oldest_id: snowflakeString.optional(),
      next_token: z.string().optional(),
    })
    .optional(),
  errors: z.array(z.unknown()).optional(),
});

const userByUsernameResponseSchema = z.object({
  data: z
    .object({
      id: snowflakeString,
      username: z.string().min(1),
      name: z.string().optional(),
    })
    .optional(),
  errors: z.array(z.unknown()).optional(),
});

export type XTweet = z.infer<typeof tweetSchema>;
export type XUser = z.infer<typeof userSchema>;
export type XMentionsResponse = z.infer<typeof mentionsResponseSchema>;
export type XUserLookupResponse = z.infer<typeof userByUsernameResponseSchema>;

export type PerceptionType = "mention" | "reply";

export type NormalizedXPerception = {
  xPostId: string;
  perceptionType: PerceptionType;
  authorXUserId: string;
  authorUsername: string | null;
  authorDisplayName: string | null;
  /** Untrusted external content — data only. */
  body: string;
  conversationId: string | null;
  referencedTweetIds: string[];
  xCreatedAt: string;
};

export function parseXErrorPayload(payload: unknown): string {
  const parsed = xErrorBodySchema.safeParse(payload);
  if (!parsed.success) {
    if (payload && typeof payload === "object") {
      return "X API error";
    }
    return "X API error";
  }
  const { title, detail, status } = parsed.data;
  const parts = [title, detail].filter(Boolean);
  const msg = parts.length > 0 ? parts.join(": ") : "X API error";
  return status !== undefined ? `${msg} (status ${status})` : msg;
}

export function validateMentionsResponse(payload: unknown): XMentionsResponse {
  const parsed = mentionsResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new XError(
      "x_invalid_response",
      "X mentions response failed validation",
      502,
      parsed.error.issues.slice(0, 5),
    );
  }
  return parsed.data;
}

export function validateUserLookupResponse(
  payload: unknown,
): XUserLookupResponse {
  const parsed = userByUsernameResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new XError(
      "x_invalid_response",
      "X user lookup response failed validation",
      502,
      parsed.error.issues.slice(0, 5),
    );
  }
  return parsed.data;
}

/**
 * Derive perception type only from reliable X metadata.
 * `replied_to` → reply; otherwise a mention timeline hit → mention.
 */
export function derivePerceptionType(
  referencedTweets: XTweet["referenced_tweets"],
): PerceptionType {
  if (
    referencedTweets?.some((ref) => ref.type === "replied_to")
  ) {
    return "reply";
  }
  return "mention";
}

export function normalizeMention(
  tweet: XTweet,
  authorsById: Map<string, XUser>,
): NormalizedXPerception {
  const xPostId = assertSnowflakeId(tweet.id, "tweet.id");
  const authorXUserId = assertSnowflakeId(tweet.author_id, "tweet.author_id");
  const author = authorsById.get(authorXUserId);

  const created = Date.parse(tweet.created_at);
  if (Number.isNaN(created)) {
    throw new XError(
      "x_invalid_response",
      `invalid created_at for tweet ${xPostId}`,
      502,
    );
  }

  const body = tweet.text;
  if (body.trim().length === 0) {
    throw new XError(
      "x_invalid_response",
      `empty text for tweet ${xPostId}`,
      502,
    );
  }
  if (body.length > 8000) {
    throw new XError(
      "x_invalid_response",
      `tweet text exceeds storage bound for ${xPostId}`,
      502,
    );
  }

  const referencedTweetIds = (tweet.referenced_tweets ?? []).map((ref) =>
    assertSnowflakeId(ref.id, "referenced_tweets.id"),
  );

  return {
    xPostId,
    perceptionType: derivePerceptionType(tweet.referenced_tweets),
    authorXUserId,
    authorUsername: author?.username ?? null,
    authorDisplayName: author?.name ?? null,
    body,
    conversationId: tweet.conversation_id
      ? assertSnowflakeId(tweet.conversation_id, "conversation_id")
      : null,
    referencedTweetIds,
    xCreatedAt: new Date(created).toISOString(),
  };
}
