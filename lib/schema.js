import { z } from "zod";

export const ScoreItem = z.object({
  pageId: z.string(),
  value: z.number().int().min(0).max(5),
  comment: z.string().max(2000).optional(),
});

export const SubmitPayload = z.object({
  items: z.array(ScoreItem).min(1),
  mode: z.enum(["draft", "final"]).default("final"),
});
