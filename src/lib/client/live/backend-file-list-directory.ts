import type { FileNode } from '$shared/types';
import type { BackendTransport } from './backend-transport-types';

/**
 * Map a raw daemon `file.list` payload into `FileNode[]`. Tolerant of the shape
 * the directory listing arrives in: a bare array, or wrapped under `entries` /
 * `files`. Children are left unset (lazy) — the explorer fetches deeper levels
 * on demand. Entries missing both a name and a path are skipped.
 */
export function toFileNodes(result: unknown): FileNode[] {
  const raw = result as { entries?: unknown[]; files?: unknown[] } | unknown[] | null;
  const entries = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.entries)
      ? raw.entries
      : Array.isArray(raw?.files)
        ? raw.files
        : [];

  const nodes: FileNode[] = [];
  for (const candidate of entries) {
    if (!candidate || typeof candidate !== 'object') continue;
    const entry = candidate as Record<string, unknown>;
    const name = typeof entry.name === 'string' ? entry.name : undefined;
    const rawPath = typeof entry.path === 'string' ? entry.path : undefined;
    const path = rawPath ?? name;
    if (!path) continue;
    const isDirectory =
      entry.type === 'directory' || entry.type === 'dir' || entry.isDirectory === true;
    const node: FileNode = {
      name: name ?? path.split('/').pop() ?? path,
      path,
      type: isDirectory ? 'directory' : 'file',
    };
    if (typeof entry.size === 'number') node.size = entry.size;
    if (typeof entry.modified === 'string') node.modified = entry.modified;
    if (typeof entry.isGitignored === 'boolean') node.isGitignored = entry.isGitignored;
    nodes.push(node);
  }
  return nodes;
}

/** Shared directory normalization used by bounded suffix recovery. */
export function createFileListDirectory(request: BackendTransport['request']) {
  return async function listDirectory(workspaceId: string, path: string): Promise<FileNode[]> {
    try {
      return toFileNodes(await request<unknown>('file.list', { workspaceId, path }));
    } catch {
      return [];
    }
  };
}
