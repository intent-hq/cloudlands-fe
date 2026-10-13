import { afterEach, describe, expect, it, vi } from 'vitest';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { RendererEventRecovery } from '$features/events/renderer-event-recovery';
import {
  createEventRecoverySession,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import {
  filesReducer,
  loadFileContentSucceeded,
  updateFileContent,
  removeFileContentEntry,
} from '$store/renderer/slices/files/files-slice';
import {
  fileExplorerReducer,
  setFileExplorerWorkspacePath,
  setRootNode,
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
function setup(recoverable = true) {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  let emit!: (n: RecoveryNotification) => void;
  let files = filesReducer(undefined, { type: 'init' }),
    fileExplorer = fileExplorerReducer(undefined, { type: 'init' });
  const listeners = new Set<() => void>();
  const dispatch = (action: { type: string; payload?: unknown }) => {
    files = filesReducer(files, action);
    fileExplorer = fileExplorerReducer(fileExplorer, action);
    for (const listener of listeners) listener();
    return action;
  };
  let activeWorkspace: string | null = 'ws';
  let authority = createAdmittedLegacyPrincipal();
  const state = () =>
    ({
      files,
      fileExplorer,
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
  const registry = new RendererEventRecovery(),
    scope = registry.attach(session);
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
  it.each(['missing', 'binary'])(
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
              rpcCode: -32603,
              message:
                kind === 'missing'
                  ? 'No such file (os error 2)'
                  : 'stream did not contain valid UTF-8',
            })
          : ordinary(method, params),
      );
      h.emit(lost());
      await flush();
      expect(h.entry()?.localContent).toBe('draft');
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
