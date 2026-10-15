import type { ContextReference } from '../../../features/agent/agent-context';
import { workspaceRelativeFilePath } from '../../../features/file/utils/workspace-file-path';
import type { ContextItem } from './input/context-item';

/** Whitelist identity on persistence and retry. Empty invalid fields keep a
 * malformed pointer visible and blocked instead of restoring an upload arm. */
export function projectRepositoryFileContextItem(
  item: Pick<ContextItem, 'id' | 'label' | 'description' | 'repositoryFile'>,
) {
  const reference = item.repositoryFile;
  return {
    id: typeof item.id === 'string' ? item.id : '',
    type: 'file' as const,
    label: typeof item.label === 'string' ? item.label : '',
    ...(typeof item.description === 'string' ? { description: item.description } : {}),
    repositoryFile: {
      workspaceId: typeof reference?.workspaceId === 'string' ? reference.workspaceId : '',
      rootPath: typeof reference?.rootPath === 'string' ? reference.rootPath : '',
      path: typeof reference?.path === 'string' ? reference.path : '',
    },
  };
}

/** The checked-file pointer from source ChatPanel; keep its legacy prompt format. */
export function formatRepositoryFileContext(path: string): string {
  // i18n-ignore (agent-directed context marker, not user-facing UI)
  return `[Currently viewing file: ${path}]`;
}

/** Prepare only explicit identities. The send owner checks current file eligibility
 * with the canonical file reader; this pure projection never reads or caches bodies. */
export function prepareRepositoryFileContext(
  workspaceId: string,
  rootPath: string,
  items: readonly ContextItem[],
):
  | { ok: true; contextReferences: ContextReference[]; workspaceContextStr: string }
  | {
      ok: false;
      itemId: string;
      reason: 'invalid-reference' | 'cross-workspace' | 'cross-root';
    } {
  const contextReferences: ContextReference[] = [];
  const parts: string[] = [];
  const paths = new Set<string>();
  for (const item of items) {
    if (!('repositoryFile' in item)) continue;
    const reference = item.repositoryFile;
    if (
      item.type !== 'file' ||
      !reference ||
      typeof reference.workspaceId !== 'string' ||
      !reference.workspaceId.trim() ||
      reference.workspaceId !== reference.workspaceId.trim() ||
      typeof reference.rootPath !== 'string' ||
      !reference.rootPath.trim() ||
      typeof reference.path !== 'string' ||
      !reference.path ||
      workspaceRelativeFilePath(reference.path, reference.rootPath) !== reference.path
    )
      return { ok: false, itemId: item.id, reason: 'invalid-reference' };
    if (reference.workspaceId !== workspaceId)
      return { ok: false, itemId: item.id, reason: 'cross-workspace' };
    if (reference.rootPath !== rootPath)
      return { ok: false, itemId: item.id, reason: 'cross-root' };
    if (paths.has(reference.path)) continue;
    paths.add(reference.path);
    contextReferences.push({
      type: 'file',
      filePath: reference.path,
      metadata: { workspaceId, rootPath },
    });
    parts.push(formatRepositoryFileContext(reference.path));
  }
  return { ok: true, contextReferences, workspaceContextStr: parts.join('\n') };
}
