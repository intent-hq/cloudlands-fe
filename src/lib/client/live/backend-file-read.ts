import { m } from '$shared/paraglide/messages.js';
import { detectBinaryContent } from '$shared/binary-file-extensions';
import { fileContentData, editableText } from '$features/file/utils/file-content';
import type {
  FileContent,
  FileContentEntry,
  FileReadTransportOptions,
} from '$store/renderer/slices/files/files-types';
import type { BackendTransport } from './backend-transport-types';
import { BackendError } from './backend-transport-types';
import { mutationErrorMessage } from './backend-mutation';

/** One small chunk also bounds plaintext rendering; independent of media budgets. */
export const FILE_TEXT_PREVIEW_BYTES = 16 * 1024;

function decodePreviewChunk(value: unknown): {
  content: string;
  bytesRead: number;
  totalBytes: number;
} {
  const chunk = value as { content?: unknown; bytesRead?: unknown; size?: unknown } | null;
  if (
    !chunk ||
    typeof chunk.content !== 'string' ||
    typeof chunk.bytesRead !== 'number' ||
    typeof chunk.size !== 'number' ||
    !Number.isSafeInteger(chunk.bytesRead) ||
    !Number.isSafeInteger(chunk.size) ||
    chunk.size < 0 ||
    chunk.bytesRead !== Math.min(chunk.size, FILE_TEXT_PREVIEW_BYTES) ||
    chunk.content.length > 4 * Math.ceil(FILE_TEXT_PREVIEW_BYTES / 3) ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(chunk.content)
  )
    throw new Error(m.file_ipc_readFailed_error());
  const decoded = atob(chunk.content);
  if (decoded.length !== chunk.bytesRead || btoa(decoded) !== chunk.content)
    throw new Error(m.file_ipc_readFailed_error());
  const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  // Streaming decode only at a real prefix boundary: defer an incomplete final
  // codepoint, but reject malformed sequences anywhere else and at actual EOF.
  const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes, {
    stream: chunk.bytesRead < chunk.size,
  });
  return { content, bytesRead: chunk.bytesRead, totalBytes: chunk.size };
}

/** Non-text controls identify binary payloads even when printable bytes dominate. */
function hasBinaryControls(content: string): boolean {
  for (let index = 0; index < content.length; index++) {
    const code = content.charCodeAt(index);
    // Preserve text whitespace (TAB/LF/VT/FF/CR) and ESC used in terminal logs.
    if (code <= 8 || (code >= 14 && code <= 26) || (code >= 28 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

/** Map raw daemon file content into a `FileContentEntry`. */
function toFileContentEntry(path: string, content: FileContent): FileContentEntry {
  return {
    path,
    absolutePath: null,
    ...fileContentData(content),
    lastUpdated: Date.now(),
    loading: false,
    saving: false,
    error: null,
    truncated: content.kind === 'read-only-text' && content.bytesRead < content.totalBytes,
  };
}

/** Canonical file.read normalization, bound to the host's transport. */
export function createFileRead(request: BackendTransport['request']) {
  return async function read(
    workspaceId: string,
    path: string,
    options?: FileReadTransportOptions,
  ): Promise<FileContentEntry | null> {
    try {
      if (options?.readOnlyPreview) {
        const chunk = await request<unknown>('file.readChunk', {
          workspaceId,
          path,
          offset: 0,
          length: FILE_TEXT_PREVIEW_BYTES,
          ...(options.gitRootId ? { gitRootId: options.gitRootId } : {}),
        });
        let preview;
        try {
          preview = decodePreviewChunk(chunk);
        } catch (error) {
          if (error instanceof TypeError)
            return toFileContentEntry(path, { kind: 'preview-only', isBinary: true });
          throw error;
        }
        return toFileContentEntry(
          path,
          hasBinaryControls(preview.content) ||
            detectBinaryContent(new TextEncoder().encode(preview.content.slice(0, 8192)))
            ? { kind: 'preview-only', isBinary: true }
            : { kind: 'read-only-text', ...preview },
        );
      }
      const result = await request<unknown>('file.read', {
        workspaceId,
        path,
        ...(options?.gitRootId ? { gitRootId: options.gitRootId } : {}),
      });
      const content =
        typeof result === 'string'
          ? result
          : typeof (result as { content?: unknown })?.content === 'string'
            ? (result as { content: string }).content
            : null;
      if (content === null) return null;
      // Binary controls survive UTF-8 decoding, including in mostly printable
      // payloads or past the shared detector's sample. Keep its other heuristics.
      const isBinary =
        hasBinaryControls(content) ||
        detectBinaryContent(new TextEncoder().encode(content.slice(0, 8192)));
      return toFileContentEntry(
        path,
        isBinary ? { kind: 'restorable-snapshot', content, isBinary: true } : editableText(content),
      );
    } catch (error) {
      // file.read uses Rust read_to_string. Its decoding failure proves that
      // the file exists but cannot be read as text. Cache only a binary marker;
      // downloads must fetch the original bytes through the workspace route.
      if (error instanceof BackendError && error.rpcCode === -32603) {
        const message = mutationErrorMessage(error);
        if (message.endsWith('stream did not contain valid UTF-8')) {
          return toFileContentEntry(path, { kind: 'preview-only', isBinary: true });
        }
        // File I/O currently has no structured not-found discriminator. Keep
        // suffix recovery for ENOENT (and Windows PATH_NOT_FOUND) only.
        if (!options?.gitRootId && /\(os error [23]\)$/.test(message)) return null;
      }
      throw error;
    }
  };
}
