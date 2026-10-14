import { backendRequest } from '$lib/client/live/backend-transport';
import { createBinaryFileRead } from '$lib/client/live/backend-binary-file-read';

export { BinaryFileReadError as PdfReadError } from '$lib/client/live/backend-binary-file-read';

/** Compatibility binding; binary validation and cancellation stay shared. */
export function readPdf(
  workspaceId: string,
  path: string,
  signal: AbortSignal,
  gitRootId?: string,
): Promise<Uint8Array<ArrayBuffer>> {
  return createBinaryFileRead(backendRequest)(workspaceId, path, signal, gitRootId);
}
