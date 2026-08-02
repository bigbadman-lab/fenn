export type FireMessageStatus = "draft" | "published" | "archived";

/** Member-safe current publication. */
export type SafePublishedFireMessage = {
  body: string;
  publishedAt: string;
};

/** Operator list/detail DTO — no secrets. */
export type OperatorFireMessage = {
  id: string;
  body: string;
  status: FireMessageStatus;
  createdAt: string;
  publishedAt: string | null;
  preview: string;
};

export type PublishFireMessageResult = {
  status: "published" | "already_published";
  messageId: string;
  publishedAt: string;
};
