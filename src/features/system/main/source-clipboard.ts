import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import {
  SOURCE_CLIPBOARD_LIFETIME_MS,
  SourceClipboardBeginSchema,
  SourceClipboardWriteSchema,
  SourceClipboardCommitSchema,
  sourceClipboardScalar,
  type SourceClipboardBegin,
  type SourceClipboardWrite,
  type SourceClipboardCommit,
  type SourceClipboardAbort,
} from '../../../shared/ipc/source-clipboard';

export class SourceClipboardError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
export interface SourceClipboardOwner {
  /** Identity is the actual WebContents, never a renderer-supplied ID. */
  key: object;
  current(): boolean;
  subscribe(revoke: () => void): () => void;
}
interface Options {
  directory: string;
  publish(text: string): Promise<void>;
  /** Admission estimate covers JS/raw buffers and native copies, not an OS allocation bound. */
  maxNativeBytes: number;
  maxOwners?: number;
  now?: () => number;
  cleanupError(error: unknown): void;
}
interface Entry {
  input: SourceClipboardBegin;
  token: string;
  owner: SourceClipboardOwner;
  revoked: boolean;
  busy?: Promise<unknown>;
  path?: string;
  file?: FileHandle;
  sequence: number;
  length: number;
  bytes: number;
  hash: ReturnType<typeof createHash>;
  phase: 'writing' | 'committing' | 'published';
  cleanup?: Promise<void>;
  unsubscribe?: () => void;
  timer?: ReturnType<typeof setTimeout>;
}

/** Main-only external staging. No source-sized value exists until commit admission.
 * Tokens are single-use and owner-bound. One physical operation per entry, no IO queue.
 * Native publication is irreversible once publish is called; retirement waits for it.
 */
export function createSourceClipboard(options: Options) {
  const entries = new Map<object, Entry>();
  const now = options.now ?? Date.now;
  let admittedBytes = 0;
  function fail(code: string): never {
    throw new SourceClipboardError(code);
  }
  const check = (e: Entry) => {
    let current = false;
    try {
      current = e.owner.current();
    } catch {
      /* Errors permanently revoke. */
    }
    e.revoked ||= !current || now() >= e.input.expiresAt;
    if (e.revoked) fail('SOURCE_CLIPBOARD_REVOKED');
  };
  const cleanup = (e: Entry): Promise<void> => {
    if (e.cleanup) return e.cleanup;
    e.cleanup = (async () => {
      // Keep a failed-close handle owned for a later abort/retirement retry.
      // Dropping it before close succeeds would lose the only cleanup handle.
      await e.file?.close();
      e.file = undefined;
      if (e.path) await fs.rm(e.path, { recursive: true, force: true });
      if (e.timer) clearTimeout(e.timer);
      e.unsubscribe?.();
      if (entries.get(e.owner.key) === e) entries.delete(e.owner.key);
    })().catch((error) => {
      e.cleanup = undefined; // Failed private cleanup remains owned and retryable.
      throw error;
    });
    return e.cleanup;
  };
  const retire = async (e: Entry) => {
    e.revoked = true;
    await e.busy?.catch(() => undefined);
    await cleanup(e);
  };
  const run = <T>(e: Entry, action: () => Promise<T>): Promise<T> => {
    if (e.busy) return Promise.reject(new SourceClipboardError('SOURCE_CLIPBOARD_BUSY'));
    // Reserve busy before calling executable/async work.
    const work = Promise.resolve().then(action);
    e.busy = work;
    return work.finally(() => {
      if (e.busy === work) e.busy = undefined;
    });
  };
  const entry = (owner: SourceClipboardOwner, p: { id: string; token: string }) => {
    const e = entries.get(owner.key);
    if (!e || e.input.id !== p.id || e.token !== p.token) fail('SOURCE_CLIPBOARD_UNKNOWN');
    return e;
  };
  const ack = (e: Entry) => ({
    id: e.input.id,
    token: e.token,
    sequence: e.sequence,
    length: e.length,
    utf8Bytes: e.bytes,
  });
  return {
    usage: () => ({ owners: entries.size, admittedBytes }),
    async begin(owner: SourceClipboardOwner, raw: SourceClipboardBegin) {
      const input = SourceClipboardBeginSchema.parse(raw);
      if (
        !owner.current() ||
        input.expiresAt <= now() ||
        input.expiresAt - now() > SOURCE_CLIPBOARD_LIFETIME_MS
      )
        fail('SOURCE_CLIPBOARD_REVOKED');
      if (entries.has(owner.key) || entries.size >= (options.maxOwners ?? 4))
        fail('SOURCE_CLIPBOARD_BUSY');
      const e: Entry = {
        input,
        owner,
        token: randomUUID(),
        revoked: false,
        sequence: 0,
        length: 0,
        bytes: 0,
        hash: createHash('sha256'),
        phase: 'writing',
      };
      entries.set(owner.key, e); // Admission precedes first filesystem await.
      const revoke = () => {
        void retire(e).catch(options.cleanupError);
      };
      return run(e, async () => {
        try {
          e.unsubscribe = owner.subscribe(revoke);
          e.timer = setTimeout(revoke, input.expiresAt - now());
          e.timer.unref?.();
          check(e);
          e.path = await fs.mkdtemp(join(options.directory, 'intent-source-clipboard-'));
          await fs.chmod(e.path, 0o700);
          check(e);
          e.file = await fs.open(join(e.path, 'source'), 'wx+', 0o600);
          check(e);
          return { ...input, token: e.token };
        } catch (error) {
          e.revoked = true;
          await cleanup(e).catch(options.cleanupError);
          throw error;
        }
      });
    },
    async write(owner: SourceClipboardOwner, raw: SourceClipboardWrite) {
      const p = SourceClipboardWriteSchema.parse(raw);
      const e = entry(owner, p);
      return run(e, async () => {
        try {
          check(e);
          if (
            e.phase !== 'writing' ||
            p.sequence !== e.sequence ||
            p.offset !== e.length ||
            p.text.length > e.input.length - e.length ||
            !sourceClipboardScalar(p.text)
          )
            fail('SOURCE_CLIPBOARD_INVALID');
          const buffer = Buffer.from(p.text, 'utf8');
          if (!Number.isSafeInteger(e.bytes + buffer.length)) fail('SOURCE_CLIPBOARD_RESOURCE');
          let at = 0;
          while (at < buffer.length) {
            check(e);
            if (!e.file) fail('SOURCE_CLIPBOARD_UNKNOWN');
            const { bytesWritten } = await e.file.write(
              buffer,
              at,
              buffer.length - at,
              e.bytes + at,
            );
            if (bytesWritten <= 0) fail('SOURCE_CLIPBOARD_IO');
            at += bytesWritten;
          }
          check(e);
          e.hash.update(buffer);
          e.bytes += buffer.length;
          e.length += p.text.length;
          e.sequence++;
          return ack(e);
        } catch (error) {
          e.revoked = true;
          await cleanup(e).catch(options.cleanupError);
          throw error;
        }
      });
    },
    async commit(owner: SourceClipboardOwner, raw: SourceClipboardCommit) {
      const p = SourceClipboardCommitSchema.parse(raw);
      const e = entry(owner, p);
      return run(e, async () => {
        let cost = 0;
        let failed = false;
        try {
          check(e);
          if (
            e.phase !== 'writing' ||
            p.sequence !== e.sequence ||
            p.length !== e.length ||
            e.length !== e.input.length ||
            p.utf8Bytes !== e.bytes
          )
            fail('SOURCE_CLIPBOARD_INVALID');
          e.phase = 'committing';
          // Conservative explicit O(N) policy estimate: raw UTF8 buffers + UTF16/native
          // copies. The OS may allocate differently; this is not constant-memory proof.
          cost = 2 * e.bytes + 8 * e.length;
          if (!Number.isSafeInteger(cost) || cost > options.maxNativeBytes - admittedBytes) {
            cost = 0;
            fail('SOURCE_CLIPBOARD_RESOURCE');
          }
          admittedBytes += cost;
          if (!e.file) fail('SOURCE_CLIPBOARD_UNKNOWN');
          const text = await e.file.readFile({ encoding: 'utf8' });
          check(e);
          if (
            text.length !== e.length ||
            Buffer.byteLength(text, 'utf8') !== e.bytes ||
            createHash('sha256').update(text).digest('hex') !== e.hash.copy().digest('hex')
          )
            fail('SOURCE_CLIPBOARD_INVALID');
          check(e); // Last main owner/backend/deadline check before irreversible native call.
          await options.publish(text);
          e.phase = 'published';
          return {
            ...ack(e),
            published: true as const,
            sha256: e.hash.digest('hex'),
            admittedBytes: cost,
          };
        } catch (error) {
          failed = true;
          throw error;
        } finally {
          e.revoked = true;
          try {
            await cleanup(e).catch((error) => {
              if (!failed) throw error;
              options.cleanupError(error);
            });
          } finally {
            admittedBytes -= cost;
          }
        }
      });
    },
    async abort(owner: SourceClipboardOwner, p: SourceClipboardAbort) {
      const e = entries.get(owner.key);
      if (!e || e.input.id !== p.id) return;
      if (p.token !== undefined && p.token !== e.token) fail('SOURCE_CLIPBOARD_UNKNOWN');
      await retire(e);
    },
  };
}
