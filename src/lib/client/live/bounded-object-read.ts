/**
 * Whole-text reads under the daemon's bounded object reads (PROTOCOL §5.9
 * "Bounded object reads"; the `maxBytes` param is presence-detected).
 *
 * `file.read` and `git.showFile` ride the main connection, so the daemon caps
 * each reply under the 500 KiB read budget. These helpers always send
 * `maxBytes`: a reply that fits is used as is, and a `truncated` reply is
 * replaced by the whole object read in windows with `file.readChunk` /
 * `git.showFileChunk`. Those are transfer methods, so `backendRequest` sends
 * them on a separate transfer connection for remote backends and the main
 * connection never carries a large frame.
 *
 * A daemon without `maxBytes` support ignores it and answers the legacy shape (a bare
 * string for `file.read`, `{ content }` for `git.showFile`), which is the
 * whole object.
 */
import { backendRequest } from './backend-transport';

/** Most bytes the daemon puts in one bounded reply's object field. */
export const OBJECT_READ_MAX_BYTES = 480_000;

/** Decoded bytes requested per chunk read (the daemon allows up to 16 MiB). */
export const OBJECT_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Largest whole object these helpers assemble: the old single-frame limit, so
 * a read that failed before the cap still fails instead of buffering more.
 */
export const OBJECT_WHOLE_MAX_BYTES = 40 * 1024 * 1024;

/** A `file.read` whose bytes are not valid UTF-8 (Rust `read_to_string` parity). */
export class InvalidUtf8Error extends Error {
  constructor(path: string) {
    super(`file.read: ${path}: stream did not contain valid UTF-8`);
    this.name = 'InvalidUtf8Error';
  }
}

type Request = <T>(method: string, params: Record<string, unknown>) => Promise<T>;

interface Chunk {
  content: string;
  bytesRead: number;
  size: number;
}

/** The text of a bounded or legacy reply, and whether it was cut. */
function readText(result: unknown): { text: string; truncated: boolean } | null {
  if (typeof result === 'string') return { text: result, truncated: false };
  if (result && typeof result === 'object') {
    const { content, truncated } = result as { content?: unknown; truncated?: unknown };
    if (typeof content === 'string') return { text: content, truncated: truncated === true };
  }
  return null;
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Every byte of an object, read in windows from offset 0. */
export async function readAllChunks(
  method: string,
  params: Record<string, unknown>,
  request: Request = backendRequest,
  chunkBytes: number = OBJECT_CHUNK_BYTES,
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let offset = 0;
  let size: number | undefined;
  for (;;) {
    const chunk = await request<Chunk>(method, {
      ...params,
      offset,
      length: chunkBytes,
    });
    if (
      !chunk ||
      typeof chunk.content !== 'string' ||
      !Number.isSafeInteger(chunk.size) ||
      !Number.isSafeInteger(chunk.bytesRead)
    ) {
      throw new Error(`${method}: invalid chunk response`);
    }
    if (chunk.size > OBJECT_WHOLE_MAX_BYTES) {
      throw new Error(
        `${method}: object is ${chunk.size} bytes, over the ${OBJECT_WHOLE_MAX_BYTES}-byte limit`,
      );
    }
    if (size === undefined) size = chunk.size;
    else if (chunk.size !== size) throw new Error(`${method}: object changed while it was read`);
    const bytes = decodeBase64(chunk.content);
    if (bytes.length !== chunk.bytesRead) {
      throw new Error(
        `${method}: content/bytesRead mismatch (${bytes.length} vs ${chunk.bytesRead})`,
      );
    }
    parts.push(bytes);
    offset += bytes.length;
    if (bytes.length < chunkBytes || offset >= size) break;
  }
  const whole = new Uint8Array(offset);
  let at = 0;
  for (const part of parts) {
    whole.set(part, at);
    at += part.length;
  }
  return whole;
}

/**
 * The whole UTF-8 text of a working-tree file (`file.read`), or `null` for a
 * reply that holds no text. Throws what `file.read` throws, and
 * {@link InvalidUtf8Error} when a chunked read is not valid UTF-8.
 */
export async function readFileText(
  params: { workspaceId: string; path: string; gitRootId?: string },
  request: Request = backendRequest,
): Promise<string | null> {
  const result = await request<unknown>('file.read', {
    ...params,
    maxBytes: OBJECT_READ_MAX_BYTES,
  });
  const read = readText(result);
  if (!read) return null;
  if (!read.truncated) return read.text;
  const bytes = await readAllChunks('file.readChunk', params, request);
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new InvalidUtf8Error(params.path);
  }
}

/**
 * The whole text of a file at a ref (`git.showFile`), decoded with
 * replacement characters like the daemon's own `content`. A reply without
 * `content` reads as `''` (the legacy fallback).
 */
export async function showFileText(
  params: { workspaceId: string; filePath: string; ref: string; gitRootId?: string },
  request: Request = backendRequest,
): Promise<string> {
  const result = await request<unknown>('git.showFile', {
    ...params,
    maxBytes: OBJECT_READ_MAX_BYTES,
  });
  const read = readText(result);
  if (!read) return '';
  if (!read.truncated) return read.text;
  const bytes = await readAllChunks('git.showFileChunk', params, request);
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
}
