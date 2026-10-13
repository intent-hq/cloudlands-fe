import { detectBinaryContent } from '$shared/binary-file-extensions';
import { fileContentData, editableText } from '$features/file/utils/file-content';
import type { FileContent, FileContentEntry } from '$store/renderer/slices/files/files-types';
import type { BackendTransport } from './backend-transport-types';
import { BackendError } from './backend-transport-types';
import { mutationErrorMessage } from './backend-mutation';

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
    truncated: false,
  };
}

/** Canonical file.read normalization, bound to the host's transport. */
export function createFileRead(request: BackendTransport['request']) {
  return async function read(
    workspaceId: string,
    path: string,
    options?: { gitRootId: string },
  ): Promise<FileContentEntry | null> {
    try {
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
