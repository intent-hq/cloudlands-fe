import type { FileNode } from '$shared/types';
import type { BackendRequestOptions } from './backend-transport-types';

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
export function createFileListDirectory(
  request: <T>(
    method: string,
    params: Record<string, unknown>,
    options?: BackendRequestOptions & { onDispatch?: () => void },
  ) => Promise<T>,
  options?: { strict: boolean },
) {
  return async function listDirectory(
    workspaceId: string,
    path: string,
    isCurrent?: () => boolean,
  ): Promise<FileNode[]> {
    if (options?.strict) {
      if (!workspaceId || !validDirectoryPath(path)) throw invalidListing();
      const onDispatch = () => {
        // i18n-ignore (internal stale-operation diagnostic)
        if (isCurrent && !isCurrent()) throw new Error('File explorer read retired');
      };
      onDispatch();
      const result = isCurrent
        ? await request<unknown>('file.list', { workspaceId, path }, { onDispatch })
        : await request<unknown>('file.list', { workspaceId, path });
      onDispatch();
      return strictFileNodes(result, path);
    }
    try {
      return toFileNodes(await request<unknown>('file.list', { workspaceId, path }));
    } catch {
      return [];
    }
  };
}

function invalidListing(): TypeError {
  // i18n-ignore (internal wire-contract diagnostic)
  return new TypeError('Invalid file.list directory response');
}

function validName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !/[/\0]/.test(name)
  );
}

function validDirectoryPath(path: string): boolean {
  return (
    path === '' || path === '.' || (path.split('/').every(validName) && !/^[a-z]:/i.test(path))
  );
}

/** file.list emits immediate {name,type} rows. Paths are derived only from the requested directory. */
function strictFileNodes(result: unknown, path: string): FileNode[] {
  if (!Array.isArray(result)) throw invalidListing();
  const seen = new Set<string>();
  return result.map((candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
      throw invalidListing();
    const entry = candidate as Record<string, unknown>;
    if (
      !validName(entry.name) ||
      (entry.type !== 'file' && entry.type !== 'directory') ||
      seen.has(entry.name)
    )
      throw invalidListing();
    const childPath = path === '' || path === '.' ? entry.name : `${path}/${entry.name}`;
    // The pinned daemon omits path. If an additive path is present, it must identify this immediate child.
    if (entry.path !== undefined && entry.path !== childPath) throw invalidListing();
    if (
      entry.children !== undefined ||
      (entry.isDirectory !== undefined && entry.isDirectory !== (entry.type === 'directory'))
    )
      throw invalidListing();
    seen.add(entry.name);
    return { name: entry.name, path: childPath, type: entry.type };
  });
}
