import { z } from "zod";

/** Strict Camp send-message body — no profile/session/reward fields. */
export const sendCampMessageBodySchema = z
  .object({
    message: z.string(),
    clientMessageId: z.string(),
  })
  .strict();

export type SendCampMessageBody = z.infer<typeof sendCampMessageBodySchema>;
