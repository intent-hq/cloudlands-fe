import { invoke, isElectron } from '$lib/electron-bridge';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  SOURCE_CLIPBOARD_CHUNK_UNITS,
  SourceClipboardBeginSchema,
  SourceClipboardLeaseSchema,
  SourceClipboardAckSchema,
  SourceClipboardReceiptSchema,
  sourceClipboardScalar,
  type SourceClipboardBegin,
} from '$shared/ipc/source-clipboard';
import type { NoteSourceSink } from '$features/notes/virtualized/editing/note-source-copy';

const c = IPC_CHANNELS.SYSTEM;
async function request(channel: string, params: unknown): Promise<unknown> {
  const result = await invoke<{ success: boolean; data?: unknown; error?: { code?: string } }>(
    channel,
    params,
  );
  if (result?.success !== true)
    throw new Error(result?.error?.code ?? 'SOURCE_CLIPBOARD_UNAVAILABLE');
  return result.data;
}

/** Desktop-only private staging. No complete string or browser clipboard fallback.
 * The document owner admits the capture, validates EOF, then hands off commit.
 * Main independently admits the O(N) native cost and acknowledges actual publication.
 */
export async function openNoteSourceClipboardSink(
  raw: SourceClipboardBegin,
): Promise<NoteSourceSink> {
  if (!isElectron()) throw new Error('SOURCE_CLIPBOARD_UNSUPPORTED');
  const input = SourceClipboardBeginSchema.parse(raw);
  let token: string | undefined;
  const abort = async () => {
    await request(c.SOURCE_CLIPBOARD_ABORT, { id: input.id, ...(token ? { token } : {}) });
  };
  try {
    const lease = SourceClipboardLeaseSchema.parse(await request(c.SOURCE_CLIPBOARD_BEGIN, input));
    if (
      lease.id !== input.id ||
      lease.length !== input.length ||
      lease.expiresAt !== input.expiresAt
    )
      throw new Error('SOURCE_CLIPBOARD_IDENTITY');
    token = lease.token;
  } catch (error) {
    // Begin may have allocated staging even when its acknowledgement was lost.
    await abort().catch(() => undefined);
    throw error;
  }
  const identity = { id: input.id, token };
  let sequence = 0,
    length = 0,
    utf8Bytes = 0,
    busy = false,
    closed = false;
  return {
    async write(text) {
      if (busy || closed) throw new Error('SOURCE_CLIPBOARD_BUSY');
      if (
        typeof text !== 'string' ||
        text.length > SOURCE_CLIPBOARD_CHUNK_UNITS ||
        text.length > input.length - length ||
        !sourceClipboardScalar(text)
      )
        throw new Error('SOURCE_CLIPBOARD_INVALID');
      if (!text.length) return;
      busy = true;
      try {
        const nextBytes = utf8Bytes + new TextEncoder().encode(text).length;
        const ack = SourceClipboardAckSchema.parse(
          await request(c.SOURCE_CLIPBOARD_WRITE, {
            ...identity,
            sequence,
            offset: length,
            text,
          }),
        );
        if (
          ack.id !== input.id ||
          ack.token !== token ||
          ack.sequence !== sequence + 1 ||
          ack.length !== length + text.length ||
          ack.utf8Bytes !== nextBytes
        )
          throw new Error('SOURCE_CLIPBOARD_IDENTITY');
        sequence = ack.sequence;
        length = ack.length;
        utf8Bytes = ack.utf8Bytes;
      } catch (error) {
        closed = true;
        throw error;
      } finally {
        busy = false;
      }
    },
    async commit() {
      if (busy || closed) throw new Error('SOURCE_CLIPBOARD_BUSY');
      if (length !== input.length) throw new Error('SOURCE_CLIPBOARD_INCOMPLETE');
      closed = true;
      busy = true;
      try {
        const receipt = SourceClipboardReceiptSchema.parse(
          await request(c.SOURCE_CLIPBOARD_COMMIT, {
            ...identity,
            sequence,
            length,
            utf8Bytes,
          }),
        );
        if (
          receipt.id !== input.id ||
          receipt.token !== token ||
          receipt.sequence !== sequence ||
          receipt.length !== length ||
          receipt.utf8Bytes !== utf8Bytes ||
          receipt.admittedBytes !== 2 * utf8Bytes + 8 * length
        )
          throw new Error('SOURCE_CLIPBOARD_IDENTITY');
      } finally {
        busy = false;
      }
    },
    async abort() {
      closed = true;
      // Main waits for physical writes/publication; abort cannot undo native output.
      await abort();
    },
  };
}
