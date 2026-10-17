import { afterEach, expect, it, vi } from 'vitest';
import { createCollection, getItem } from '@themislib/themis/utils/collections/collection-utils';
import { RendererEventRecovery } from '$features/events/renderer-event-recovery';
import {
  createEventRecoverySession,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import { createAdmittedLegacyPrincipal } from '../../test/fixtures/admitted-legacy-principal';
import type { StoreState } from '$store/renderer/types';
import { selectWorkspaceParticipationContext } from '$store/renderer/slices/workspace/workspace-selectors';
import {
  gitReducer,
  gitReadRequested,
  gitReadStarted,
  gitReadCompleted,
} from '$store/renderer/slices/git/git-slice';
import { gitReadKey } from '$store/renderer/slices/git/utils/git-read-key';
import { installGitContentRecovery } from './git-content-recovery';
import { captureGitRead, gitContentRecoveryKey } from './git-recovery-read-lane';
import { captureGitAuthority } from './git-recovery-authority';

const settle = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const off of cleanup.splice(0)) off();
  vi.useRealTimers();
});
function setup() {
  vi.useFakeTimers();
  const principal = createAdmittedLegacyPrincipal();
  let state = {
    ...principal,
    workspace: {
      workspaces: createCollection(
        'id',
        ['ws', 'other'].map((id) => ({ id, myRole: 'owner', worktreePath: '/repo' })),
      ),
      deletionTokens: {},
      hasLoaded: true,
      loadedBackendId: principal.connections.windowBackendId,
    },
    git: gitReducer.initialState,
    gitRoots: { byWorkspaceId: {} },
    panelLayout: { byWorkspaceId: {} },
  } as StoreState;
  const listeners = new Set<() => void>();
  const applied: unknown[] = [];
  const store = {
    getState: () => state,
    dispatch: (action: { type: string }) => {
      state = { ...state, git: gitReducer(state.git, action) };
      applied.push(
        state.git.byWorkspaceId.ws &&
          getItem(
            state.git.byWorkspaceId.ws.reads,
            gitReadKey({ kind: 'showFile', ref: 'HEAD', filePath: 'a.ts' }),
          )?.result,
      );
      for (const fn of listeners) fn();
    },
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  let emit!: (event: RecoveryNotification) => void;
  let resolve!: (value: { content: string }) => void;
  const held = new Promise<{ content: string }>((done) => {
    resolve = done;
  });
  let showCalls = 0;
  const request = vi.fn(async (method: string, params?: unknown): Promise<unknown> => {
    if (method === 'events.subscribe') return { subscriptionId: 'lease', lossRecovery: 1 };
    if (method === 'events.fence') return params;
    if (method === 'git.showFile')
      return ++showCalls === 1 ? held : { content: 'fresh member reply' };
    throw new Error(method);
  });
  const registry = new RendererEventRecovery();
  const scope = registry.attach(
    createEventRecoverySession({
      supported: true,
      isCurrent: () => true,
      onRetired: () => () => {},
      dispose: () => {},
      onNotification: (fn) => {
        emit = fn;
        return () => {};
      },
      request: async (method, params, observe) => {
        const result = await request(method, params);
        observe?.(result);
        return result;
      },
    }),
  );
  const read = { kind: 'showFile' as const, ref: 'HEAD', filePath: 'a.ts' };
  const key = gitReadKey(read);
  for (const ws of ['ws', 'other']) {
    store.dispatch(gitReadRequested(ws, 'view', 'request', read));
    store.dispatch(gitReadStarted(ws, key, 'old'));
    store.dispatch(
      gitReadCompleted(ws, key, 'old', { kind: 'showFile', content: 'private' }, null),
    );
  }
  const off = installGitContentRecovery(scope, store);
  cleanup.push(() => {
    off();
    registry.dispose();
  });
  return {
    store,
    scope,
    request,
    resolve,
    applied,
    key,
    entry: (ws = 'ws') => getItem(state.git.byWorkspaceId[ws].reads, key)!,
    membership: (member: boolean) => {
      state = {
        ...state,
        workspace: {
          ...state.workspace,
          workspaces: createCollection('id', [
            {
              ...getItem(state.workspace.workspaces, 'ws')!,
              myRole: member ? 'owner' : undefined,
              canManage: member,
            },
            getItem(state.workspace.workspaces, 'other')!,
          ]),
        },
      };
      for (const fn of listeners) fn();
    },
    loss: () =>
      emit({
        method: 'events.lost',
        params: { subscriptionId: 'lease', generation: '1', scope: { workspaceId: 'ws' } },
      }),
  };
}
it.each([false, true])(
  'retires Git replies on retained-row membership removal (regrant=%s)',
  async (regrant) => {
    const h = setup();
    const old = captureGitAuthority(h.scope, h.store, 'ws');
    const other = captureGitAuthority(h.scope, h.store, 'other');
    expect(old()).toBe(true);
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['git:*'] }, { recover: true });
    h.loss();
    await settle();
    expect(h.request.mock.calls.filter(([method]) => method === 'git.showFile')).toHaveLength(1);
    h.membership(false);
    expect(selectWorkspaceParticipationContext.select(h.store.getState(), 'ws')).toBeNull();
    expect(h.entry().result).toBeNull();
    expect(old()).toBe(false);
    if (regrant) {
      h.membership(true);
      expect(captureGitAuthority(h.scope, h.store, 'ws')()).toBe(true);
      expect(old()).toBe(false);
    }
    h.resolve({ content: 'old member reply' });
    await settle();
    expect(h.entry().result).toEqual(
      regrant ? { kind: 'showFile', content: 'fresh member reply' } : null,
    );
    expect(h.applied).not.toContainEqual({ kind: 'showFile', content: 'old member reply' });
    expect(other()).toBe(true);
    expect(h.entry('other').result).toEqual({ kind: 'showFile', content: 'private' });
    expect(h.request.mock.calls.filter(([method]) => method === 'git.showFile')).toHaveLength(
      regrant ? 2 : 1,
    );
  },
);

it('does not revive an ordinary root transport after membership revoke and regrant', async () => {
  const h = setup();
  const lane = captureGitRead(gitContentRecoveryKey('ws', h.key));
  const pending = lane
    .transport!.request('git.showFile', { workspaceId: 'ws', ref: 'HEAD', filePath: 'a.ts' })
    .catch((error) => error);
  await settle();
  h.membership(false);
  h.membership(true);
  h.resolve({ content: 'old member reply' });
  expect(await pending).toBeInstanceOf(Error);
  await settle();
  expect(h.entry().result).toEqual({ kind: 'showFile', content: 'fresh member reply' });
  expect(h.request.mock.calls.filter(([method]) => method === 'git.showFile')).toHaveLength(2);
});
