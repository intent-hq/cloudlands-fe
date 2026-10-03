import { z } from 'zod';
import { ReverseRpcHandlerError } from '../../backend/main/json-rpc-client';
import type { DesktopError } from '../../../shared/types/desktop';

const id = z.string().min(1).max(512);
const finite = z.number().finite();
const point = z.object({ x: finite.nonnegative(), y: finite.nonnegative() }).strict();
const position = { displayId: id.optional(), layoutId: id, ...point.shape };
const namedKeys = new Set([
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
]);
const desktopActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('listDisplay') }).strict(),
  z
    .object({ kind: z.literal('screenshot'), displayId: id.optional(), layoutId: id.optional() })
    .strict(),
  z
    .object({
      kind: z.literal('click'),
      ...position,
      button: z.enum(['left', 'right']).optional(),
      clickCount: z.union([z.literal(1), z.literal(2)]).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('type'),
      text: z
        .string()
        .refine(
          (t) =>
            Buffer.byteLength(t, 'utf8') <= 16384 &&
            !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(t),
        ),
    })
    .strict(),
  z
    .object({
      kind: z.literal('keypress'),
      key: z
        .string()
        .refine((k) => namedKeys.has(k) || ([...k].length === 1 && !/[\p{C}\p{Z}]/u.test(k))),
      modifiers: z
        .array(z.enum(['Shift', 'Control', 'Alt', 'Meta']))
        .max(4)
        .refine((m) => new Set(m).size === m.length)
        .optional(),
    })
    .strict(),
  z.object({ kind: z.literal('scroll'), ...position, deltaX: finite, deltaY: finite }).strict(),
  z
    .object({
      kind: z.literal('drag'),
      displayId: id.optional(),
      layoutId: id,
      from: point,
      to: point,
    })
    .strict(),
]);
const binding = { workspaceId: id, agentId: id, principalId: id, connectionEpoch: id };
const session = { ...binding, computerId: id, sessionId: id };
const command = {
  ...session,
  commandId: id,
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
};
const desktopRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('prepare'), ...binding }).strict(),
  z
    .object({
      operation: z.literal('startControl'),
      ...session,
      agentName: id,
      leaseMs: z.literal(15000),
      stopReportToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    })
    .strict(),
  z.object({ operation: z.literal('renew'), ...session, leaseMs: z.literal(15000) }).strict(),
  z.object({ operation: z.literal('endControl'), ...session }).strict(),
  z
    .object({ operation: z.literal('prepareCommand'), ...command, action: desktopActionSchema })
    .strict(),
  z.object({ operation: z.literal('execute'), ...command, deadlineId: id }).strict(),
]);
export type DesktopRequest = z.infer<typeof desktopRequestSchema>;
export function desktopFailure(
  code: string,
  detail: string,
  execution?: DesktopError['execution'],
): ReverseRpcHandlerError {
  const numeric =
    code === 'forbidden'
      ? -32003
      : [
            'invalid-params',
            'desktop-not-active',
            'desktop-stale-request',
            'desktop-stale-command',
            'desktop-stale-layout',
            'desktop-display-selection-required',
            'desktop-display-unavailable',
            'desktop-command-expired',
          ].includes(code)
        ? -32602
        : -32603;
  return new ReverseRpcHandlerError(numeric, detail, {
    code,
    detail,
    ...(execution ? { execution } : {}),
  });
}
export function parseDesktopRequest(raw: unknown): DesktopRequest {
  const result = desktopRequestSchema.safeParse(raw);
  if (!result.success)
    throw desktopFailure('invalid-params', 'Invalid desktop control request', 'not_started');
  return result.data;
}
