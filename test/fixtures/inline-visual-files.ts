import type { FilesClient } from '$lib/client/app-client';
import { fileContentData, editableText } from '$features/file/utils/file-content';

/** A durable fake daemon filesystem, outside the opaque authored frame. */
export function createInlineVisualFiles() {
  const prefix = 'test:inline-visual-file:';
  const requests: { method: 'read' | 'write'; workspaceId: string; path: string }[] = [];
  let readFailure = false;
  let writeFailure = false;
  const key = (workspaceId: string, path: string) => prefix + JSON.stringify([workspaceId, path]);
  const client: Pick<FilesClient, 'read' | 'write'> = {
    async read(workspaceId, path) {
      requests.push({ method: 'read', workspaceId, path });
      if (readFailure) throw new Error('Fixture filesystem is unavailable.');
      const content = localStorage.getItem(key(workspaceId, path));
      if (content === null) return null;
      return {
        path,
        absolutePath: null,
        ...fileContentData(editableText(content)),
        lastUpdated: 0,
        loading: false,
        saving: false,
        error: null,
        truncated: false,
      };
    },
    async write(workspaceId, path, content) {
      requests.push({ method: 'write', workspaceId, path });
      if (writeFailure) return { success: false, error: 'Fixture filesystem is read-only.' };
      localStorage.setItem(key(workspaceId, path), content.content);
      return { success: true };
    },
  };
  return {
    client,
    requests,
    fault(read: boolean, write: boolean) {
      readFailure = read;
      writeFailure = write;
    },
    files() {
      return Object.keys(localStorage)
        .filter((entry) => entry.startsWith(prefix))
        .map((entry) => ({
          scope: JSON.parse(entry.slice(prefix.length)) as [string, string],
          content: localStorage.getItem(entry)!,
        }));
    },
  };
}
