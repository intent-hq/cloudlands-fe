import { requireRootFileSupport } from '$lib/client/live/require-root-file-support';
import { backendRequest } from '$lib/client/live/backend-transport';
import { BackendError } from '$lib/client/live/backend-transport-types';

const CHUNK_BYTES = 1024 * 1024;
const MAX_BYTES = 64 * 1024 * 1024;

export class PdfReadError extends Error {
  constructor(readonly reason: 'missing' | 'large' | 'load') {
    super(reason);
  }
}

/** Read binary data on the requesting window's backend; never use UTF-8 file.read. */
export async function readPdf(
  workspaceId: string,
  path: string,
  signal: AbortSignal,
  gitRootId?: string,
): Promise<Uint8Array<ArrayBuffer>> {
  signal.throwIfAborted();
  if (gitRootId) await requireRootFileSupport();
  let data: Uint8Array<ArrayBuffer> | undefined;
  let offset = 0;
  do {
    signal.throwIfAborted();
    let chunk: { content: string; bytesRead: number; size: number };
    try {
      chunk = await backendRequest('file.readChunk', {
        workspaceId,
        path,
        offset,
        length: CHUNK_BYTES,
        ...(gitRootId ? { gitRootId } : {}),
      });
    } catch (error) {
      // file.readChunk uses the daemon's generic internal-error code for I/O.
      // Only an OS missing-file error is absence; permission/transport errors are not.
      if (
        error instanceof BackendError &&
        error.rpcCode === -32603 &&
        /\(os error (?:2|3)\)$/.test(error.message)
      ) {
        throw new PdfReadError('missing');
      }
      throw new PdfReadError('load');
    }
    signal.throwIfAborted();
    if (
      !Number.isSafeInteger(chunk.size) ||
      chunk.size < 0 ||
      !Number.isSafeInteger(chunk.bytesRead) ||
      chunk.bytesRead < 0 ||
      chunk.bytesRead > CHUNK_BYTES ||
      offset + chunk.bytesRead > chunk.size ||
      typeof chunk.content !== 'string' ||
      (data && data.length !== chunk.size)
    )
      throw new PdfReadError('load');
    if (chunk.size > MAX_BYTES) throw new PdfReadError('large');
    data ??= new Uint8Array(chunk.size);
    let decoded: string;
    try {
      decoded = atob(chunk.content);
    } catch {
      throw new PdfReadError('load');
    }
    if (decoded.length !== chunk.bytesRead || (!chunk.bytesRead && offset < chunk.size)) {
      throw new PdfReadError('load');
    }
    for (let i = 0; i < decoded.length; i++) data[offset + i] = decoded.charCodeAt(i);
    offset += chunk.bytesRead;
  } while (offset < data.length);
  return data;
}
