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

export type ElementPickerMessage =
  | { type: 'cancelled' }
  | { type: 'picked'; element: BrowserElementPayload }
  | { type: 'malformed'; issues: z.ZodIssue[] };

const PICKED_PREFIX = '__INTENT_ELEMENT_PICKED__:';

export function parseElementPickerMessage(message: string): ElementPickerMessage | null {
  if (message === '__INTENT_ELEMENT_PICK_CANCELLED__') return { type: 'cancelled' };
  if (!message.startsWith(PICKED_PREFIX)) return null;
  let value: unknown;
  try {
    value = JSON.parse(message.slice(PICKED_PREFIX.length));
  } catch {
    value = null;
  }
  const parsed = browserElementPayloadSchema.safeParse(value);
  return parsed.success
    ? { type: 'picked', element: parsed.data }
    : { type: 'malformed', issues: parsed.error.issues };
}
