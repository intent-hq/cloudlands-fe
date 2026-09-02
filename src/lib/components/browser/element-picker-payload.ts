import { z } from 'zod';

export const browserElementPayloadSchema = z
  .object({
    selector: z.string().min(1),
    domPath: z.string().min(1),
    tagName: z.string().min(1),
    id: z.string(),
    className: z.string(),
    textSnippet: z.string().max(120),
    rect: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().finite().nonnegative(),
        height: z.number().finite().nonnegative(),
      })
      .strict(),
    pageUrl: z.string().min(1),
    sourceRef: z.string().min(1).optional(),
  })
  .strict();

export type BrowserElementPayload = z.infer<typeof browserElementPayloadSchema>;
