import { z } from 'zod';

export const SOURCE_CLIPBOARD_CHUNK_UNITS = 4096;
export const SOURCE_CLIPBOARD_LIFETIME_MS = 600_000;
const uint = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id = z.string().uuid();
export const SourceClipboardBeginSchema = z.object({ id, length: uint, expiresAt: uint }).strict();
const SourceClipboardTokenSchema = z.object({ id, token: id }).strict();
export const SourceClipboardWriteSchema = SourceClipboardTokenSchema.extend({
  sequence: uint,
  offset: uint,
  text: z.string().min(1).max(SOURCE_CLIPBOARD_CHUNK_UNITS),
}).strict();
export const SourceClipboardCommitSchema = SourceClipboardTokenSchema.extend({
  sequence: uint,
  length: uint,
  utf8Bytes: uint,
}).strict();
export const SourceClipboardAbortSchema = z.object({ id, token: id.optional() }).strict();
export const SourceClipboardLeaseSchema = SourceClipboardBeginSchema.extend({ token: id }).strict();
export const SourceClipboardAckSchema = z
  .object({ id, token: id, sequence: uint, length: uint, utf8Bytes: uint })
  .strict();
export const SourceClipboardReceiptSchema = SourceClipboardAckSchema.extend({
  published: z.literal(true),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  admittedBytes: uint,
}).strict();
export type SourceClipboardBegin = z.infer<typeof SourceClipboardBeginSchema>;
export type SourceClipboardWrite = z.infer<typeof SourceClipboardWriteSchema>;
export type SourceClipboardCommit = z.infer<typeof SourceClipboardCommitSchema>;
export type SourceClipboardAbort = z.infer<typeof SourceClipboardAbortSchema>;

/** IPC data is already decoded; this is a bounded scalar check, not predecode admission. */
export function sourceClipboardScalar(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0 || (c >= 0xdc00 && c <= 0xdfff)) return false;
    if (c >= 0xd800 && c <= 0xdbff) {
      const low = text.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false;
    }
  }
  return true;
}
