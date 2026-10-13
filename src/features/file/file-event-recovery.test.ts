import { fileExplorerSaga } from '$store/renderer/slices/file-explorer/sagas/file-explorer-saga';
import { runSaga, stdChannel } from 'redux-saga';
import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import { filesReadSaga } from '$store/renderer/slices/files/sagas/files-read-saga';
import { gitRootsReducer, gitRootsUpdated } from '$store/renderer/slices/git-roots/git-roots-slice';
import type { GitRootRow } from '$features/git-roots/git-roots-service';
import { filesWriteSaga } from '$store/renderer/slices/files/sagas/files-write-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCollection, getItem } from '@themislib/themis/utils/collections/collection-utils';
import { trackWorktreeSnapshotRead } from '$features/file-tracking/worktree-read-lane';
import {
  RendererEventRecovery,
  rendererEventRecovery,
} from '$features/events/renderer-event-recovery';
import {
  createEventRecoverySession,
  RecoveryRequestTimeoutError,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import {
  filesReducer,
  loadFileContentSucceeded,
  loadFileContentRequested,
  saveFileContentRequested,
  updateFileContent,
  removeFileContentEntry,
} from '$store/renderer/slices/files/files-slice';
import {
  fileExplorerReducer,
  hydrateFileExplorerRequested,
  setFileExplorerWorkspacePath,
  setRootNode,
  updateAgentFileEditsEntries,
  addExpandedPath,
  fileSearchRequested,
  fileSearchReleased,
} from '$store/renderer/slices/file-explorer/file-explorer-slice';
import { workspaceUnmounted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { createAdmittedLegacyPrincipal } from '../../test/fixtures/admitted-legacy-principal';
import type { StoreState } from '$store/renderer/types';
import { installFileEventRecovery } from './file-event-recovery';
import { demandFileRead, demandFileSearch } from './file-recovery-demand';
import { fileContentRecoveryKey } from './file-recovery-keys';

const flush = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
const lost = (generation = '1') => ({
  method: 'events.lost',
  params: { subscriptionId: 'lease', generation, scope: { workspaceId: 'ws' } },
});
const text = (content: string) => ({ kind: 'editable-text' as const, content });
function setup(recoverable = true, registry = new RendererEventRecovery()) {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  let emit!: (n: RecoveryNotification) => void;
  let files = filesReducer(undefined, { type: 'init' }),
    fileExplorer = fileExplorerReducer(undefined, { type: 'init' }),
    gitRoots = gitRootsReducer(undefined, { type: 'init' });
  const listeners = new Set<() => void>();
  const channel = stdChannel();
  let workspaceVisible = true;
  const dispatch = (action: { type: string; payload?: unknown }) => {
    files = filesReducer(files, action);
    gitRoots = gitRootsReducer(gitRoots, action);
    fileExplorer = fileExplorerReducer(fileExplorer, action);
    for (const listener of listeners) listener();
    channel.put(action);
    return action;
  };
  let activeWorkspace: string | null = 'ws';
  let authority = createAdmittedLegacyPrincipal();
  const state = () =>
    ({
      files,
      gitRoots,
      fileExplorer,
      workspace: {
        workspaces: createCollection(
          'id',
          workspaceVisible ? [{ id: 'ws', myRole: 'owner', worktreePath: '/repo' }] : [],
        ),
        deletionTokens: {},
      },
      tabState: { currentTabId: activeWorkspace },
      ...authority,
    }) as StoreState;
  const request = vi.fn(async (method: string, params?: unknown): Promise<unknown> => {
    if (method === 'events.subscribe')
      return { subscriptionId: 'lease', ...(recoverable ? { lossRecovery: 1 } : {}) };
    if (method === 'events.fence') return params;
    if (method === 'events.unsubscribe') return {};
    if (method === 'file.read') return 'disk new';
    if (method === 'file.tree') return [{ name: 'src', path: 'src', type: 'directory' }];
    if (method === 'file.list') return [{ name: 'new.ts', path: 'src/new.ts', type: 'file' }];
    if (method === 'event.query') return [];
    if (method === 'search.fileNames') return { files: ['src/new.ts'] };
    throw new Error(method);
  });
  const session = createEventRecoverySession({
    supported: recoverable,
    isCurrent: () => true,
    onRetired: () => () => {},
    onNotification: (cb) => {
      emit = cb;
      return () => {};
    },
    request: async (method, params, observe) => {
      const result = await request(method, params);
      observe?.(result);
      return result;
    },
    dispose: () => {},
  });
  const scope = registry.attach(session);
  const off = installFileEventRecovery(scope, {
    getState: state,
    dispatch,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
  return {
    registry,
    channel,
    setWorkspaceVisible: (visible: boolean) => {
      workspaceVisible = visible;
      for (const listener of listeners) listener();
    },
    setActive: (value: string | null) => {
      activeWorkspace = value;
      for (const listener of listeners) listener();
    },
    changePrincipal: () => {
      authority = {
        ...authority,
        principal: { ...authority.principal, invalidation: authority.principal.invalidation + 1 },
      };
      for (const listener of listeners) listener();
    },
    scope,
    request,
    dispatch,
    state,
    emit: (event: RecoveryNotification) => emit(event),
    entry: () =>
      files.byWorkspaceId.ws ? getItem(files.byWorkspaceId.ws.files, 'a.ts') : undefined,
    close: () => {
      registry.dispose();
      off();
    },
  };
}
afterEach(() => vi.useRealTimers());
describe('file projections after lost final events', () => {
  const root: GitRootRow = {
    id: 'root',
    workspaceId: 'ws',
    path: '/repo/sub',
    source: 'agent',
    createdAt: 'first',
    updatedAt: 'first',
  };
  const otherRoot: GitRootRow = { ...root, id: 'other', path: '/repo/other' };

  it('does not start an ordinary file read for an unregistered secondary root', async () => {
    const h = setup(true, rendererEventRecovery);
    const read = vi.spyOn(appClient.files, 'read').mockResolvedValue(null);
    const task = runSaga(
      { channel: h.channel, getState: h.state, dispatch: h.dispatch },
      filesReadSaga,
    );
    try {
      h.dispatch(
        loadFileContentRequested('ws', 'a.ts', '/repo/sub/a.ts', {
          gitRoot: { id: root.id, relativePath: 'a.ts' },
        }),
      );
      await flush();
      expect(read).not.toHaveBeenCalled();
      expect(h.entry()).toBeUndefined();
    } finally {
      task.cancel();
      await task.toPromise();
      h.close();
      read.mockRestore();
    }
  });

  describe.each(['ordinary', 'recovery'] as const)('%s secondary-root file reads', (mode) => {
    it.each(['remove', 'remove-readd', 'path-replacement', 'incarnation-replacement'] as const)(
      'rejects late data after root %s and preserves unrelated drafts',
      async (change) => {
        const h = setup(true, rendererEventRecovery);
        const held = deferred<any>();
        const normal = h.request.getMockImplementation()!;
        const read = vi.spyOn(appClient.files, 'read').mockReturnValue(held.promise);
        const task = runSaga(
          { channel: h.channel, getState: h.state, dispatch: h.dispatch },
          filesReadSaga,
        );
        h.dispatch(gitRootsUpdated('ws', [root, otherRoot]));
        demandFileRead('ws', 'a.ts', { gitRoot: { id: root.id, relativePath: 'a.ts' } });
        h.dispatch(loadFileContentSucceeded('ws', 'a.ts', '/repo/sub/a.ts', text('private root')));
        demandFileRead('ws', 'b.ts', { gitRoot: { id: otherRoot.id, relativePath: 'b.ts' } });
        h.dispatch(loadFileContentSucceeded('ws', 'b.ts', '/repo/other/b.ts', text('other base')));
        h.dispatch(updateFileContent('ws', 'b.ts', text('other draft'), { autoSave: false }));
        try {
          if (mode === 'recovery') {
            h.request.mockImplementation((method, params) =>
              method === 'file.read' && (params as { gitRootId?: string }).gitRootId === root.id
                ? held.promise
                : normal(method, params),
            );
            await h.scope.subscribe(
              { workspaceId: 'ws', eventTypes: ['file:*'] },
              { recover: true },
            );
            h.emit(lost());
          } else {
            h.dispatch(
              loadFileContentRequested('ws', 'a.ts', '/repo/sub/a.ts', {
                gitRoot: { id: root.id, relativePath: 'a.ts' },
              }),
            );
          }
          await flush();
          if (mode === 'ordinary') expect(read).toHaveBeenCalledTimes(1);
          else
            expect(h.request).toHaveBeenCalledWith('file.read', {
              workspaceId: 'ws',
              path: 'a.ts',
              gitRootId: root.id,
            });
          if (change === 'remove' || change === 'remove-readd')
            h.dispatch(gitRootsUpdated('ws', [otherRoot]));
          else
            h.dispatch(
              gitRootsUpdated('ws', [
                otherRoot,
                {
                  ...root,
                  ...(change === 'path-replacement'
                    ? { path: '/replacement' }
                    : { createdAt: 'second' }),
                },
              ]),
            );
          expect(h.entry()).toBeUndefined();
          if (change === 'remove-readd') {
            h.dispatch(gitRootsUpdated('ws', [root, otherRoot]));
            demandFileRead('ws', 'a.ts', { gitRoot: { id: root.id, relativePath: 'a.ts' } });
            h.dispatch(
              loadFileContentSucceeded('ws', 'a.ts', '/repo/sub/a.ts', text('new incarnation')),
            );
            h.dispatch(
              updateFileContent('ws', 'a.ts', text('new incarnation draft'), { autoSave: false }),
            );
          }
          held.resolve(
            mode === 'ordinary'
              ? {
                  kind: 'editable-text',
                  originalContent: 'old removed-root reply',
                  truncated: false,
                }
              : 'old removed-root reply',
          );
          await flush();
          if (change !== 'remove-readd') expect(h.entry()).toBeUndefined();
          expect(getItem(h.state().files.byWorkspaceId.ws.files, 'b.ts')?.localContent).toBe(
            'other draft',
          );
          if (change === 'remove-readd') {
            const receipt = h.registry.capture(fileContentRecoveryKey('ws', 'a.ts'));
            expect(receipt.commit(() => undefined)).toBe(true);
            expect(h.entry()).toMatchObject({
              originalContent: 'new incarnation',
              localContent: 'new incarnation draft',
            });
          }
        } finally {
          held.resolve(null);
          await flush();
          task.cancel();
          await task.toPromise();
          h.close();
          read.mockRestore();
        }
      },
    );

    it('keeps current-root reads and drafts across other-root removal and branch updates', async () => {
      const h = setup(true, rendererEventRecovery);
      const held = deferred<any>();
      const normal = h.request.getMockImplementation()!;
      const read = vi.spyOn(appClient.files, 'read').mockReturnValue(held.promise);
      const task = runSaga(
        { channel: h.channel, getState: h.state, dispatch: h.dispatch },
        filesReadSaga,
      );
      h.dispatch(gitRootsUpdated('ws', [root, otherRoot]));
      demandFileRead('ws', 'a.ts', { gitRoot: { id: root.id, relativePath: 'a.ts' } });
      h.dispatch(loadFileContentSucceeded('ws', 'a.ts', '/repo/sub/a.ts', text('base')));
      try {
        if (mode === 'recovery') {
          h.request.mockImplementation((method, params) =>
            method === 'file.read' ? held.promise : normal(method, params),
          );
          await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['file:*'] }, { recover: true });
          h.emit(lost());
        } else
          h.dispatch(
            loadFileContentRequested('ws', 'a.ts', '/repo/sub/a.ts', {
              gitRoot: { id: root.id, relativePath: 'a.ts' },
            }),
          );
        await flush();
        h.dispatch(updateFileContent('ws', 'a.ts', text('new draft'), { autoSave: false }));
        h.dispatch(gitRootsUpdated('ws', [{ ...root, branch: 'another', updatedAt: 'later' }]));
        held.resolve(
          mode === 'ordinary'
            ? { kind: 'editable-text', originalContent: 'current disk', truncated: false }
            : 'current disk',
        );
        await flush();
        expect(h.entry()).toMatchObject({
          originalContent: 'current disk',
          localContent: 'new draft',
        });
      } finally {
        held.resolve(null);
        await flush();
        task.cancel();
        await task.toPromise();
        h.close();
        read.mockRestore();
      }
    });
  });

  it('preserves file edit badge physical siblings after a transient failure', async () => {
    const h = setup();
    h.dispatch(setFileExplorerWorkspacePath('ws', '/repo'));
    h.dispatch(updateAgentFileEditsEntries('ws', { 'old.ts': ['old-agent'] }));
    const held = deferred<unknown>();
    const normal = h.request.getMockImplementation()!;
    let initial = true;
    h.request.mockImplementation((method, params) => {
      if (method !== 'event.query') return normal(method, params);
      const changed = (params as { eventType: string }).eventType === 'file:changed';
      if (initial) return changed ? Promise.reject(new Error('transient')) : held.promise;
      return Promise.resolve(
        changed
          ? [{ timestamp: '2026-10-13', actor: { id: 'new-agent' }, data: { path: 'new.ts' } }]
          : [],
      );
    });
    try {
      await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['file:*'] }, { recover: true });
      h.emit(lost());
      await flush();
      expect(h.request.mock.calls.filter(([method]) => method === 'event.query')).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1001);
      await flush();
      expect(h.request.mock.calls.filter(([method]) => method === 'event.query')).toHaveLength(2);
      initial = false;
      held.resolve([]);
      await flush();
      await vi.advanceTimersByTimeAsync(1001);
      await flush();
      expect(h.request.mock.calls.filter(([method]) => method === 'event.query')).toHaveLength(4);
      expect(h.state().fileExplorer.byWorkspaceId.ws.agentFileEdits['new.ts']).toEqual([
        'new-agent',
      ]);
      expect(h.state().fileExplorer.byWorkspaceId.ws.agentFileEdits['old.ts']).toBeUndefined();
    } finally {
      held.resolve([]);
      await flush();
      h.close();
    }
  });

  it.each([false, true])(
    'retires file badges promptly while retaining a physical sibling (late timeout=%s)',
    async (timeout) => {
      const h = setup();
      h.dispatch(setFileExplorerWorkspacePath('ws', '/repo'));
      h.dispatch(updateAgentFileEditsEntries('ws', { 'private.ts': ['agent'] }));
      const held = deferred<unknown>();
      const completion = deferred<{ retired: boolean; errors: unknown[] }>();
      const denied = { rpcCode: -32003 };
      const normal = h.request.getMockImplementation()!;
      h.request.mockImplementation((method, params) =>
        method === 'event.query'
          ? (params as { eventType: string }).eventType === 'file:changed'
            ? Promise.reject(timeout ? new RecoveryRequestTimeoutError(completion.promise) : denied)
            : held.promise
          : normal(method, params),
      );
      try {
        await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['file:*'] }, { recover: true });
        h.emit(lost());
        await flush();
        if (timeout) {
          await vi.advanceTimersByTimeAsync(1001);
          await flush();
          expect(h.request.mock.calls.filter(([method]) => method === 'event.query')).toHaveLength(
            2,
          );
          completion.resolve({ retired: false, errors: [denied] });
          await flush();
        }
        expect(h.state().fileExplorer.byWorkspaceId.ws.agentFileEdits).toEqual({});
        await vi.advanceTimersByTimeAsync(1001);
        await flush();
        expect(h.request.mock.calls.filter(([method]) => method === 'event.query')).toHaveLength(2);
      } finally {
        completion.resolve({ retired: false, errors: [] });
        held.resolve([]);
        await flush();
        h.close();
      }
    },
  );

  it('keeps the badge lane occupied after one timeout drains while its sibling is still held', async () => {
    const h = setup();
    h.dispatch(setFileExplorerWorkspacePath('ws', '/repo'));
    const held = deferred<unknown>();
    const completion = deferred<{ retired: boolean; errors: unknown[] }>();
    const normal = h.request.getMockImplementation()!;
    h.request.mockImplementation((method, params) =>
      method === 'event.query'
        ? (params as { eventType: string }).eventType === 'file:changed'
          ? Promise.reject(new RecoveryRequestTimeoutError(completion.promise))
          : held.promise
        : normal(method, params),
    );
    try {
      await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['file:*'] }, { recover: true });
      h.emit(lost());
      await flush();
      completion.resolve({ retired: false, errors: [] });
      await flush();
      await vi.advanceTimersByTimeAsync(1001);
      await flush();
      expect(h.request.mock.calls.filter(([method]) => method === 'event.query')).toHaveLength(2);
    } finally {
      completion.resolve({ retired: false, errors: [] });
      held.resolve([]);
      await flush();
      h.close();
    }
  });

  it('does not retire a replacement badge owner on an old timed-out denial', async () => {
    const h = setup();
    h.dispatch(setFileExplorerWorkspacePath('ws', '/repo'));
    const held = deferred<unknown>();
    const completion = deferred<{ retired: boolean; errors: unknown[] }>();
    const normal = h.request.getMockImplementation()!;
    h.request.mockImplementation((method, params) =>
      method === 'event.query'
        ? (params as { eventType: string }).eventType === 'file:changed'
          ? Promise.reject(new RecoveryRequestTimeoutError(completion.promise))
          : held.promise
        : normal(method, params),
    );
    try {
      await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['file:*'] }, { recover: true });
      h.emit(lost());
      await flush();
      h.setWorkspaceVisible(false);
      h.setWorkspaceVisible(true);
      h.dispatch(updateAgentFileEditsEntries('ws', { 'new-owner.ts': ['new-agent'] }));
      completion.resolve({ retired: false, errors: [{ rpcCode: -32003 }] });
      await flush();
      expect(h.state().fileExplorer.byWorkspaceId.ws.agentFileEdits).toEqual({
        'new-owner.ts': ['new-agent'],
      });
    } finally {
      completion.resolve({ retired: false, errors: [] });
      held.resolve([]);
      await flush();
      h.close();
    }
  });

  it.each([false, true])(
    'keeps ordinary reads admitted when a pre-loss file notice carries no store snapshot (recovery=%s)',
    async (recoverable) => {
      const h = setup(recoverable);
      h.dispatch(loadFileContentSucceeded('ws', 'a.ts', '/repo/a.ts', text('base')));
      await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['file:*'] }, { recover: true });
      const receipt = h.registry.capture(fileContentRecoveryKey('ws', 'a.ts'));
      h.emit({
        method: 'events.event',
        params: {
          subscriptionId: 'lease',
          event: { type: 'file:changed', workspaceId: 'ws', data: { path: 'a.ts' } },
        },
      });
      await flush();
      expect(
        receipt.commit(() =>
          h.dispatch(loadFileContentSucceeded('ws', 'a.ts', '/repo/a.ts', text('ordinary read'))),
        ),
      ).toBe(true);
      expect(h.entry()?.originalContent).toBe('ordinary read');
      expect(
        h.request.mock.calls.filter(
          ([method]) => method === 'file.read' || method === 'events.fence',
        ),
      ).toHaveLength(0);
      h.close();
    },
  );

  it('hydrates a newly admitted explorer from the shallow live tree without dropping its first snapshot', async () => {
    const h = setup(true, rendererEventRecovery);
    const tree = vi.spyOn(appClient.files, 'explorerTree').mockResolvedValue({
      name: '',
      path: '',
      type: 'directory',
      children: [{ name: 'a.ts', path: 'a.ts', type: 'file' }],
    });
    const git = vi.spyOn(appClient.files, 'gitStatusMap').mockResolvedValue({});
    const task = runSaga(
      { channel: h.channel, getState: h.state, dispatch: h.dispatch },
      fileExplorerSaga,
    );
    try {
      h.dispatch(hydrateFileExplorerRequested('ws'));
      await flush();
      expect(h.state().fileExplorer.byWorkspaceId.ws).toMatchObject({
        workspacePath: '/repo',
        rootPath: '/repo',
        isInitialized: true,
        isLoading: false,
      });
      expect(getItem(h.state().fileExplorer.byWorkspaceId.ws.nodes, '/repo/a.ts')).toBeDefined();
      expect(tree).toHaveBeenCalledTimes(1);
    } finally {
      task.cancel();
      await task.toPromise();
      h.close();
      tree.mockRestore();
      git.mockRestore();
    }
  });

  it('settles a save that spans loss without replaying it or replacing a newer draft', async () => {
    const h = setup(true, rendererEventRecovery);
    const held = deferred<{ success: boolean }>();
    const write = vi.spyOn(appClient.files, 'write').mockReturnValueOnce(held.promise);
    const state = vi.spyOn(appStore, 'state', 'get').mockImplementation(h.state);
    const task = runSaga(
      { channel: h.channel, getState: h.state, dispatch: h.dispatch },
      filesWriteSaga,
    );
    try {
      h.dispatch(loadFileContentSucceeded('ws', 'a.ts', '/repo/a.ts', text('base')));
      h.dispatch(saveFileContentRequested('ws', 'a.ts', '/repo/a.ts', text('saved')));
      await flush();
      await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['file:*'] }, { recover: true });
      h.emit(lost());
      await flush();
      expect(h.entry()?.saving).toBe(true);
      h.dispatch(updateFileContent('ws', 'a.ts', text('new draft'), { autoSave: false }));
      held.resolve({ success: true });
      await flush();
      await vi.advanceTimersByTimeAsync(250);
      await flush();
      expect(write).toHaveBeenCalledTimes(1);
      expect(h.entry()).toMatchObject({
        originalContent: 'disk new',
        localContent: 'new draft',
        saving: false,
      });
      expect(h.request.mock.calls.filter(([method]) => method === 'file.read')).toHaveLength(2);
      expect(h.request.mock.calls.filter(([method]) => method === 'events.fence')).toHaveLength(4);
    } finally {
      task.cancel();
      await task.toPromise();
      h.close();
      write.mockRestore();
      state.mockRestore();
    }
  });

  it('retires a workspace membership before an old content reply can reappear after rejoin', async () => {
    const h = setup();
    h.dispatch(loadFileContentSucceeded('ws', 'a.ts', '/repo/a.ts', text('private')));
    const receipt = h.registry.capture(fileContentRecoveryKey('ws', 'a.ts'));
    h.setWorkspaceVisible(false);
    expect(h.entry()).toBeUndefined();
    h.setWorkspaceVisible(true);
    h.dispatch(loadFileContentSucceeded('ws', 'a.ts', '/repo/a.ts', text('new incarnation')));
    expect(
      receipt.commit(() =>
        h.dispatch(loadFileContentSucceeded('ws', 'a.ts', '/repo/a.ts', text('old private'))),
      ),
    ).toBe(false);
    expect(h.entry()?.originalContent).toBe('new incarnation');
    h.close();
  });

  it('waits for an outstanding ordinary physical read before recovering the final content', async () => {
    const h = setup();
    h.dispatch(loadFileContentSucceeded('ws', 'a.ts', '/repo/a.ts', text('base')));
    const held = deferred<string>();
    const receipt = h.registry.capture(fileContentRecoveryKey('ws', 'a.ts'));
    const ordinary = trackWorktreeSnapshotRead(
      fileContentRecoveryKey('ws', 'a.ts'),
      () => held.promise,
    );
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['file:*'] }, { recover: true });
    h.emit(lost());
    await flush();
    expect(h.request.mock.calls.filter(([method]) => method === 'file.read')).toHaveLength(0);
    held.resolve('obsolete');
    await ordinary;
    expect(
      receipt.commit(() =>
        h.dispatch(loadFileContentSucceeded('ws', 'a.ts', '/repo/a.ts', text('obsolete'))),
      ),
    ).toBe(false);
    await flush();
    expect(h.entry()?.originalContent).toBe('disk new');
    expect(h.request.mock.calls.filter(([method]) => method === 'file.read')).toHaveLength(1);
    expect(h.request.mock.calls.filter(([method]) => method === 'events.fence')).toHaveLength(2);
    h.close();
  });

  it('recovers text, expanded tree, search and edit badges with bounded exact reads and keeps a draft', async () => {
    const h = setup();
    h.dispatch(loadFileContentSucceeded('ws', 'a.ts', '/repo/a.ts', text('base')));
    h.dispatch(updateFileContent('ws', 'a.ts', text('unsaved'), { autoSave: false }));
    h.dispatch(setFileExplorerWorkspacePath('ws', '/repo'));
    h.dispatch(
      setRootNode('ws', {
        name: 'repo',
        path: '/repo',
        type: 'directory',
        children: [{ name: 'old.ts', path: '/repo/old.ts', type: 'file' }],
      }),
    );
    h.dispatch(addExpandedPath('ws', '/repo/src'));
    h.dispatch(fileSearchRequested('ws', 'search', 'r1', 'new'));
    demandFileSearch('ws', 'search', 'r1', 'new');
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['file:*'] }, { recover: true });
    h.emit(lost());
    h.emit(lost());
    await flush();
    expect(h.entry()).toMatchObject({ originalContent: 'disk new', localContent: 'unsaved' });
    expect(
      getItem(h.state().fileExplorer.byWorkspaceId.ws.nodes, '/repo/src/new.ts'),
    ).toBeDefined();
    expect(getItem(h.state().fileExplorer.byWorkspaceId.ws.nodes, '/repo/old.ts')).toBeUndefined();
    expect(getItem(h.state().fileExplorer.searches, 'search')?.paths).toEqual(['src/new.ts']);
    expect(h.request.mock.calls.filter(([m]) => m === 'file.read')).toEqual([
      ['file.read', { workspaceId: 'ws', path: 'a.ts' }],
    ]);
    expect(h.request.mock.calls.filter(([m]) => m === 'file.tree')).toEqual([
      ['file.tree', { workspaceId: 'ws', path: '.' }],
    ]);
    expect(h.request.mock.calls.filter(([m]) => m === 'file.list')).toEqual([
      ['file.list', { workspaceId: 'ws', path: 'src' }],
    ]);
    expect(h.request.mock.calls.filter(([m]) => m === 'event.query')).toHaveLength(2);
    expect(h.request.mock.calls.filter(([m]) => m === 'events.fence')).toHaveLength(8);
    expect(h.request.mock.calls.some(([m]) => m === 'file.write')).toBe(false);
    h.close();
  });
  it('rejects an old ordinary read and reconciles a delayed unversioned push after recovery', async () => {
    const h = setup();
    h.dispatch(loadFileContentSucceeded('ws', 'a.ts', '/repo/a.ts', text('base')));
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['file:*'] }, { recover: true });
    const old = h.registry.capture(fileContentRecoveryKey('ws', 'a.ts'));
    h.emit(lost());
    await flush();
    expect(
      old.commit(() => {
        h.dispatch(loadFileContentSucceeded('ws', 'a.ts', '/repo/a.ts', text('late')));
      }),
    ).toBe(false);
    h.emit({
      method: 'events.event',
      params: {
        subscriptionId: 'lease',
        event: { type: 'file:changed', workspaceId: 'ws', data: { content: 'old' } },
      },
    });
    expect(h.entry()).toMatchObject({ originalContent: 'disk new' });
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    expect(h.request.mock.calls.filter(([m]) => m === 'file.read')).toHaveLength(2);
    expect(h.request.mock.calls.filter(([m]) => m === 'events.fence')).toHaveLength(4);
    h.close();
  });
  it('coalesces a loss burst during a held read into one trailing cycle', async () => {
    const h = setup(),
      held = deferred<unknown>();
    h.dispatch(loadFileContentSucceeded('ws', 'a.ts', '/repo/a.ts', text('base')));
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['file:*'] }, { recover: true });
    const ordinary = h.request.getMockImplementation()!;
    h.request.mockImplementation((method, params) =>
      method === 'file.read' ? held.promise : ordinary(method, params),
    );
    h.emit(lost());
    await flush();
    h.emit(lost('2'));
    h.emit(lost('3'));
    held.resolve('held');
    await flush();
    expect(h.entry()).toMatchObject({ originalContent: 'base' });
    h.request.mockImplementation(ordinary);
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    expect(h.entry()).toMatchObject({ originalContent: 'disk new' });
    expect(h.request.mock.calls.filter(([m]) => m === 'file.read')).toHaveLength(2);
    h.close();
  });
  it.each(['entry', 'workspace', 'backend', 'subscription'])(
    'rejects held recovery across %s ABA',
    async (kind) => {
      const h = setup(),
        held = deferred<unknown>();
      h.dispatch(loadFileContentSucceeded('ws', 'a.ts', '/repo/a.ts', text('base')));
      await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['file:*'] }, { recover: true });
      const ordinary = h.request.getMockImplementation()!;
      h.request.mockImplementation((method, params) =>
        method === 'file.read' ? held.promise : ordinary(method, params),
      );
      h.emit(lost());
      await flush();
      if (kind === 'backend') h.registry.dispose();
      else if (kind === 'subscription') {
        await h.scope.unsubscribe('lease');
        await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['file:*'] }, { recover: true });
      } else {
        h.dispatch(
          kind === 'entry' ? removeFileContentEntry('ws', 'a.ts') : workspaceUnmounted('ws'),
        );
        h.dispatch(loadFileContentSucceeded('ws', 'a.ts', '/repo/a.ts', text('replacement')));
      }
      held.resolve('old authority');
      await flush();
      expect(h.entry()?.originalContent).not.toBe('old authority');
      h.close();
    },
  );
  it('keeps inactive cached content stale until its workspace is demanded', async () => {
    const h = setup();
    h.dispatch(loadFileContentSucceeded('ws', 'a.ts', '/repo/a.ts', text('base')));
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['file:*'] }, { recover: true });
    h.setActive('other');
    h.emit(lost());
    await flush();
    expect(h.request.mock.calls.filter(([m]) => m === 'file.read')).toHaveLength(0);
    h.setActive('ws');
    await flush();
    expect(h.entry()?.originalContent).toBe('disk new');
    h.close();
  });
  it('clears protected projections synchronously when principal authority changes', async () => {
    const h = setup();
    h.dispatch(loadFileContentSucceeded('ws', 'a.ts', '/repo/a.ts', text('private')));
    const receipt = h.registry.capture(fileContentRecoveryKey('ws', 'a.ts'));
    h.changePrincipal();
    expect(h.entry()).toBeUndefined();
    expect(receipt.commit(() => undefined)).toBe(false);
    h.close();
  });
  it('retires only the missing content entry on canonical not-found', async () => {
    const h = setup();
    h.dispatch(loadFileContentSucceeded('ws', 'a.ts', '/repo/a.ts', text('base')));
    h.dispatch(loadFileContentSucceeded('ws', 'b.ts', '/repo/b.ts', text('base')));
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['file:*'] }, { recover: true });
    const ordinary = h.request.getMockImplementation()!;
    h.request.mockImplementation((method, params) =>
      method === 'file.read' && (params as { path: string }).path === 'a.ts'
        ? Promise.reject({ rpcCode: -32602, data: { code: 'not-found' } })
        : ordinary(method, params),
    );
    h.emit(lost());
    await flush();
    expect(h.entry()).toBeUndefined();
    expect(getItem(h.state().files.byWorkspaceId.ws.files, 'b.ts')?.originalContent).toBe(
      'disk new',
    );
    h.close();
  });
  it('preserves local edits made while a recovery read is held', async () => {
    const h = setup(),
      held = deferred<unknown>();
    h.dispatch(loadFileContentSucceeded('ws', 'a.ts', '/repo/a.ts', text('base')));
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['file:*'] }, { recover: true });
    const ordinary = h.request.getMockImplementation()!;
    h.request.mockImplementation((method, params) =>
      method === 'file.read' ? held.promise : ordinary(method, params),
    );
    h.emit(lost());
    await flush();
    h.dispatch(updateFileContent('ws', 'a.ts', text('new draft'), { autoSave: false }));
    held.resolve('disk');
    await flush();
    expect(h.entry()).toMatchObject({ originalContent: 'disk', localContent: 'new draft' });
    h.close();
  });
  it.each(['missing', 'binary', 'canonical missing'])(
    'handles documented %s file I/O without losing a draft',
    async (kind) => {
      const h = setup();
      h.dispatch(loadFileContentSucceeded('ws', 'a.ts', '/repo/a.ts', text('base')));
      h.dispatch(updateFileContent('ws', 'a.ts', text('draft'), { autoSave: false }));
      await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['file:*'] }, { recover: true });
      const ordinary = h.request.getMockImplementation()!;
      h.request.mockImplementation((method, params) =>
        method === 'file.read'
          ? Promise.reject({
              rpcCode: kind === 'canonical missing' ? -32602 : -32603,
              data: { code: 'not-found' },
              message:
                kind === 'missing'
                  ? 'No such file (os error 2)'
                  : 'stream did not contain valid UTF-8',
            })
          : ordinary(method, params),
      );
      h.emit(lost());
      await flush();
      expect(h.entry()).toMatchObject({
        kind: 'preview-only',
        preservedDraft: 'draft',
        localContent: null,
        loading: false,
      });
      expect(h.request.mock.calls.filter(([m]) => m === 'file.read')).toHaveLength(1);
      h.close();
    },
  );
  it('clears deleted clean content using the documented file I/O error', async () => {
    const h = setup();
    h.dispatch(loadFileContentSucceeded('ws', 'a.ts', '/repo/a.ts', text('base')));
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['file:*'] }, { recover: true });
    const ordinary = h.request.getMockImplementation()!;
    h.request.mockImplementation((method, params) =>
      method === 'file.read'
        ? Promise.reject({ rpcCode: -32603, message: 'No such file (os error 2)' })
        : ordinary(method, params),
    );
    h.emit(lost());
    await flush();
    expect(h.entry()).toBeUndefined();
    h.close();
  });
  it('keeps searches scoped to the latest request and releases their owners', async () => {
    const h = setup(),
      held = deferred<unknown>();
    h.dispatch(fileSearchRequested('ws', 'search', 'old', 'old'));
    demandFileSearch('ws', 'search', 'old', 'old');
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['file:*'] }, { recover: true });
    const ordinary = h.request.getMockImplementation()!;
    h.request.mockImplementation((method, params) =>
      method === 'search.fileNames' ? held.promise : ordinary(method, params),
    );
    h.emit(lost());
    await flush();
    h.dispatch(fileSearchRequested('ws', 'search', 'new', 'new'));
    demandFileSearch('ws', 'search', 'new', 'new');
    held.resolve({ files: ['old'] });
    await flush();
    expect(getItem(h.state().fileExplorer.searches, 'search')?.paths).toEqual([]);
    h.dispatch(fileSearchReleased('ws', 'search'));
    h.emit(lost('2'));
    await flush();
    expect(h.request.mock.calls.filter(([m]) => m === 'search.fileNames')).toHaveLength(1);
    h.close();
  });
  it('uses git-root routing and does not add loss recovery on a legacy subscription', async () => {
    const h = setup(false);
    h.dispatch(gitRootsUpdated('ws', [root]));
    h.dispatch(loadFileContentSucceeded('ws', 'a.ts', '/external/a.ts', text('base')));
    demandFileRead('ws', 'a.ts', { gitRoot: { id: 'root', relativePath: 'actual.ts' } });
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['file:*'] }, { recover: true });
    h.emit(lost());
    await flush();
    expect(h.request.mock.calls).toEqual([
      ['events.subscribe', { workspaceId: 'ws', eventTypes: ['file:*'] }],
    ]);
    h.close();
    const modern = setup();
    modern.dispatch(gitRootsUpdated('ws', [root]));
    modern.dispatch(loadFileContentSucceeded('ws', 'a.ts', '/external/a.ts', text('base')));
    demandFileRead('ws', 'a.ts', { gitRoot: { id: 'root', relativePath: 'actual.ts' } });
    await modern.scope.subscribe({ workspaceId: 'ws', eventTypes: ['file:*'] }, { recover: true });
    modern.emit(lost());
    await flush();
    expect(modern.request).toHaveBeenCalledWith('file.read', {
      workspaceId: 'ws',
      path: 'actual.ts',
      gitRootId: 'root',
    });
    modern.close();
  });
});
