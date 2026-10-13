import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import type {
  RendererRecoveryHandle,
  RendererRecoveryScope,
} from '$features/events/renderer-event-recovery';
import type { RecoveryReader } from '$features/events/event-recovery-coordinator';
import type { WorkspaceEvent } from '$features/events/types';
import { parseFileReadResult, toFileNodes } from '$lib/client/live/live-files-client';
import { propagateAgentEditsToParents } from '$lib/utils/agent-file-edits';
import { stripWorkspacePrefix } from '$lib/utils/file-utils';
import { getPrincipalActionContext } from '$store/renderer/slices/principal/principal-context';
import type { StoreState } from '$store/renderer/types';
import type { FileContentEntry } from '$store/renderer/slices/files/files-types';
import {
  loadFileContentSucceeded,
  removeFileContentEntry,
} from '$store/renderer/slices/files/files-slice';
import {
  fileSearchReleased,
  fileSearchSettled,
  removeAgentFileEditsEntries,
  setFileExplorerInitialized,
  setFileExplorerFileCount,
  setFileExplorerLoading,
  setRootNode,
  updateAgentFileEditsEntries,
} from '$store/renderer/slices/file-explorer/file-explorer-slice';
import type { FileNode } from '$shared/types';
import {
  fileContentRecoveryKey,
  fileExplorerRecoveryKey,
  fileEditsRecoveryKey,
  fileSearchRecoveryKey,
} from './file-recovery-keys';
import { fileReadDemands, fileSearchDemands, onFileRecoveryDemand } from './file-recovery-demand';

export interface FileRecoveryStore {
  getState(): StoreState;
  dispatch(action: { type: string; payload?: unknown }): unknown;
  subscribe(listener: () => void): () => void;
}
const dirty = (entry: FileContentEntry | undefined) =>
  entry?.kind === 'editable-text' && entry.localContent !== entry.originalContent;
const anchor = (nodes: FileNode[], path: string): FileNode[] =>
  nodes.map((node) => ({
    ...node,
    path: `${path}/${node.name}`,
    ...(node.type === 'directory' ? { children: [] } : {}),
  }));

async function readEdits(workspaceId: string, root: string, { request }: RecoveryReader) {
  const results = await Promise.all(
    ['file:changed', 'file:created'].map((eventType) =>
      request<WorkspaceEvent[]>('event.query', {
        workspaceId,
        eventType,
        actorType: 'agent',
        limit: 100,
      }),
    ),
  );
  if (results.some((events) => !Array.isArray(events)))
    throw new Error('Invalid event.query response');
  const byAgent = new Map<string, Set<string>>();
  for (const event of results.flat().sort((a, b) => b.timestamp.localeCompare(a.timestamp))) {
    const agentId = event.actor?.id;
    const path = event.data?.relativePath || event.data?.path || event.data?.filePath;
    if (!agentId || typeof path !== 'string') continue;
    const paths = byAgent.get(agentId) ?? new Set<string>();
    if (paths.size < 3) paths.add(path);
    byAgent.set(agentId, paths);
  }
  const byFile = new Map<string, string[]>();
  for (const [agent, paths] of byAgent)
    for (const path of paths) byFile.set(path, [...(byFile.get(path) ?? []), agent]);
  return Object.fromEntries(propagateAgentEditsToParents(byFile, root, root));
}

/** No subscription here: the central scoped file lease supplies every owner. */
export function installFileEventRecovery(
  scope: RendererRecoveryScope,
  store: FileRecoveryStore,
): () => void {
  const treeDemands = new Map<string, string>();
  const owners = new Map<
    string,
    { handle: RendererRecoveryHandle; identity: string; alive: boolean }
  >();
  const principal = getPrincipalActionContext(store.getState());
  let disposed = false,
    syncing = false;
  const current = () =>
    !disposed && scope.isCurrent() && principal === getPrincipalActionContext(store.getState());
  const entry = (ws: string, path: string) => {
    const files = store.getState().files.byWorkspaceId[ws]?.files;
    return files && getItem(files, path);
  };
  const sync = () => {
    if (syncing || disposed) return;
    syncing = true;
    try {
      const needed = new Set<string>();
      const own = (
        key: string,
        identity: string,
        create: (isCurrent: () => boolean) => RendererRecoveryHandle,
        active = true,
      ) => {
        needed.add(key);
        let row = owners.get(key);
        if (row && row.identity !== identity) {
          row.alive = false;
          row.handle.dispose();
          owners.delete(key);
          row = undefined;
        }
        if (!row) {
          const next = {
            identity,
            alive: true,
            handle: undefined as unknown as RendererRecoveryHandle,
          };
          next.handle = create(() => next.alive && current());
          owners.set(key, next);
          row = next;
        }
        row.handle.setActive(active);
      };
      const state = store.getState();
      const activeWorkspace = (workspaceId: string) => state.tabState?.currentTabId === workspaceId;
      for (const [workspaceId, ws] of Object.entries(state.files.byWorkspaceId)) {
        for (const file of getItems(ws.files)) {
          if (!file.absolutePath) continue;
          const absolutePath = file.absolutePath;
          const key = fileContentRecoveryKey(workspaceId, file.path);
          const options = fileReadDemands.get(key);
          own(
            key,
            JSON.stringify([file.absolutePath, options?.gitRoot]),
            (isCurrent) =>
              scope.registerResource({
                key,
                workspaceId,
                eventTypes: ['file:*'],
                isCurrent,
                read: async ({ request }) => {
                  try {
                    const result = await request<unknown>('file.read', {
                      workspaceId,
                      path: options?.gitRoot?.relativePath ?? file.path,
                      ...(options?.gitRoot ? { gitRootId: options.gitRoot.id } : {}),
                    });
                    const parsed = parseFileReadResult(file.path, result);
                    if (!parsed) throw new Error('Invalid file.read response');
                    return parsed;
                  } catch (error) {
                    const failure = error as { rpcCode?: number; message?: string };
                    // file.read's documented I/O convention predates canonical
                    // not-found. Keep the narrow ENOENT handling of the file client.
                    if (
                      failure.rpcCode === -32603 &&
                      /\(os error [23]\)$/.test(failure.message ?? '')
                    )
                      return null;
                    if (
                      failure.rpcCode === -32603 &&
                      failure.message?.endsWith('stream did not contain valid UTF-8')
                    )
                      return { kind: 'preview-only' as const, isBinary: true, truncated: false };
                    throw error;
                  }
                },
                apply: (value) => {
                  if (!value) {
                    if (!dirty(entry(workspaceId, file.path)))
                      store.dispatch(removeFileContentEntry(workspaceId, file.path));
                    return;
                  }
                  // Text snapshots update the disk baseline while the reducer keeps
                  // the draft. A changed binary representation cannot erase a draft.
                  if (dirty(entry(workspaceId, file.path)) && value.kind !== 'editable-text')
                    return;
                  const content =
                    value.kind === 'editable-text'
                      ? { kind: 'editable-text' as const, content: value.originalContent }
                      : value.kind === 'restorable-snapshot'
                        ? {
                            kind: 'restorable-snapshot' as const,
                            content: value.originalContent,
                            isBinary: true as const,
                          }
                        : { kind: 'preview-only' as const, isBinary: value.isBinary };
                  store.dispatch(
                    loadFileContentSucceeded(
                      workspaceId,
                      file.path,
                      absolutePath,
                      content,
                      value.truncated,
                    ),
                  );
                },
                invalidate: () => {},
                retire: () => {
                  store.dispatch(removeFileContentEntry(workspaceId, file.path));
                },
              }),
            activeWorkspace(workspaceId),
          );
        }
      }
      for (const [workspaceId, ws] of Object.entries(state.fileExplorer.byWorkspaceId)) {
        if (!ws.workspacePath) continue;
        const root = ws.workspacePath;
        const treeKey = fileExplorerRecoveryKey(workspaceId);
        const treeDemand = JSON.stringify(ws.expandedPaths);
        const previousDemand = treeDemands.get(treeKey);
        treeDemands.set(treeKey, treeDemand);
        if (
          previousDemand !== undefined &&
          previousDemand !== treeDemand &&
          owners.get(treeKey)?.handle.status.stale
        )
          owners.get(treeKey)?.handle.invalidate();
        own(
          fileExplorerRecoveryKey(workspaceId),
          root,
          (isCurrent) =>
            scope.registerResource({
              key: fileExplorerRecoveryKey(workspaceId),
              workspaceId,
              eventTypes: ['file:*'],
              isCurrent,
              read: async ({ request }) => {
                const latest = store.getState().fileExplorer.byWorkspaceId[workspaceId];
                const raw = await request<unknown>('file.tree', { workspaceId, path: '.' });
                if (!Array.isArray(raw)) throw new Error('Invalid file.tree response');
                const tree: FileNode = {
                  name: root.split('/').pop() ?? root,
                  path: root,
                  type: 'directory',
                  children: anchor(toFileNodes(raw), root),
                };
                const nodes = new Map<string, FileNode>([
                  [root, tree],
                  ...(tree.children ?? []).map((n) => [n.path, n] as const),
                ]);
                for (const path of [...new Set(latest?.expandedPaths ?? [])].sort(
                  (a, b) => a.length - b.length,
                )) {
                  if (path === root || !path.startsWith(`${root}/`)) continue;
                  const node = nodes.get(path);
                  if (node?.type !== 'directory') continue;
                  const children = await request<unknown>('file.list', {
                    workspaceId,
                    path: stripWorkspacePrefix(path, root),
                  });
                  if (!Array.isArray(children)) throw new Error('Invalid file.list response');
                  node.children = anchor(toFileNodes(children), path);
                  for (const child of node.children) nodes.set(child.path, child);
                }
                return tree;
              },
              apply: (tree) => {
                store.dispatch(setRootNode(workspaceId, tree));
                const count = (node: FileNode): number =>
                  node.type === 'file'
                    ? 1
                    : (node.children ?? []).reduce((total, child) => total + count(child), 0);
                store.dispatch(setFileExplorerFileCount(workspaceId, count(tree)));
                store.dispatch(setFileExplorerInitialized(workspaceId, true));
                store.dispatch(setFileExplorerLoading(workspaceId, false));
              },
              invalidate: () => {},
              retire: () => {
                store.dispatch(setRootNode(workspaceId, null));
                store.dispatch(setFileExplorerInitialized(workspaceId, false));
              },
            }),
          ws.isStoreActive && activeWorkspace(workspaceId),
        );
        own(
          fileEditsRecoveryKey(workspaceId),
          root,
          (isCurrent) =>
            scope.registerResource({
              key: fileEditsRecoveryKey(workspaceId),
              workspaceId,
              eventTypes: ['file:*'],
              isCurrent,
              read: (reader) => readEdits(workspaceId, root, reader),
              apply: (edits) => {
                const old = Object.keys(
                  store.getState().fileExplorer.byWorkspaceId[workspaceId]?.agentFileEdits ?? {},
                );
                store.dispatch(
                  removeAgentFileEditsEntries(
                    workspaceId,
                    old.filter((path) => !(path in edits)),
                  ),
                );
                store.dispatch(updateAgentFileEditsEntries(workspaceId, edits));
              },
              invalidate: () => {},
              retire: () => {
                store.dispatch(
                  removeAgentFileEditsEntries(
                    workspaceId,
                    Object.keys(
                      store.getState().fileExplorer.byWorkspaceId[workspaceId]?.agentFileEdits ??
                        {},
                    ),
                  ),
                );
              },
            }),
          ws.isStoreActive && activeWorkspace(workspaceId),
        );
      }
      for (const search of getItems(state.fileExplorer.searches)) {
        const { workspaceId, consumerId, requestId } = search;
        const key = fileSearchRecoveryKey(workspaceId, consumerId),
          demand = fileSearchDemands.get(key);
        if (!demand?.query || demand.requestId !== requestId) continue;
        own(key, requestId, (isCurrent) =>
          scope.registerResource({
            key,
            workspaceId,
            eventTypes: ['file:*'],
            isCurrent,
            read: ({ request }) =>
              request<{ files: string[] }>('search.fileNames', {
                workspaceId,
                pattern: demand.query,
                limit: 100,
              }),
            apply: (result) => {
              store.dispatch(
                fileSearchSettled(workspaceId, consumerId, requestId, result.files, null),
              );
            },
            invalidate: () => {},
            retire: () => {
              store.dispatch(fileSearchReleased(workspaceId, consumerId));
            },
          }),
        );
      }
      for (const [key, row] of owners)
        if (!needed.has(key)) {
          row.alive = false;
          row.handle.dispose();
          owners.delete(key);
          treeDemands.delete(key);
          fileReadDemands.delete(key);
          fileSearchDemands.delete(key);
        }
      if (!current())
        for (const row of owners.values()) row.handle.captureLifetime().commit(() => undefined);
    } finally {
      syncing = false;
    }
  };
  const offStore = store.subscribe(sync),
    offDemand = onFileRecoveryDemand(sync);
  sync();
  return () => {
    disposed = true;
    offStore();
    offDemand();
    for (const [key, row] of owners) {
      row.alive = false;
      row.handle.dispose();
      fileReadDemands.delete(key);
      fileSearchDemands.delete(key);
    }
    owners.clear();
  };
}
