import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendRequest } from '$lib/client/live/backend-transport';
import { invoke } from '$lib/electron-bridge';
import { store as appStore } from '../../../store';
import { startRootStoreLifecycle } from '../../../root-store-lifecycle';
import { chatChangesSaga } from './chat-changes-saga';
import { gitWriteSaga } from '../../git/sagas/git-write-saga';
import {
  chatChangesInputChanged,
  chatChangesConsumerReleased,
  agentFileRefreshTriggered,
  chatChangesHunkRequested,
} from '../chat-changes-slice';
import { selectChatChanges, selectChatChangesConsumer } from '../chat-changes-selectors';
import { setAgentLockState } from '../../agent-lock/agent-lock-slice';
import { bulkUpsertSessions } from '../../agent-session/agent-session-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus, type AgentSession } from '$shared/types';
import type { ChatChangesInput } from '../chat-changes-types';
import type { LocalFileChange } from '$lib/components/chat/types';

vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: vi.fn() }));
vi.mock('$lib/electron-bridge', async (original) => ({
  ...(await original<typeof import('$lib/electron-bridge')>()),
  invoke: vi.fn(),
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));

const hunk = {
  oldStart: 1,
  oldLines: 1,
  newStart: 1,
  newLines: 1,
  lines: [
    { type: 'Deletion', content: 'old', oldNumber: 1 },
    { type: 'Addition', content: 'new', newNumber: 1 },
  ],
};
const patch = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n';
const change = (filePath = 'a.ts', fields: Partial<LocalFileChange> = {}): LocalFileChange => ({
  filePath,
  action: 'modify',
  toolName: 'git',
  toolCallId: filePath,
  additions: 1,
  deletions: 1,
  category: 'unstaged',
  staged: false,
  ...fields,
});
const input = (changes = [change()], fields: Partial<ChatChangesInput> = {}): ChatChangesInput => ({
  changes,
  showStagingControls: true,
  isAggregate: false,
  groupByCommit: false,
  nodeOwnedPaths: false,
  ...fields,
});
const calls = (method: string) =>
  vi.mocked(backendRequest).mock.calls.filter(([name]) => name === method);
const rows = (wsId = 'ws', id = 'panel') => selectChatChanges.select(appStore.state, wsId, id);
const consumer = (wsId = 'ws', id = 'panel') =>
  selectChatChangesConsumer.select(appStore.state, wsId, id);
const send = (value: ChatChangesInput, wsId = 'ws', id = 'panel') =>
  appStore.dispatch(chatChangesInputChanged(wsId, id, crypto.randomUUID(), value));
const agent = (remote: boolean): AgentSession => ({
  id: AgentId('agent'),
  workspaceId: WorkspaceId('ws'),
  backendSessionId: null,
  name: 'Fixture',
  status: AgentStatus.Halted,
  messages: [],
  createdAt: '2026-09-29T00:00:00Z',
  updatedAt: '2026-09-29T00:00:00Z',
  ...(remote ? { nodePath: '/node', placement: { target: 'remote', checkout: 'isolated' } } : {}),
});
let stop: () => void;
let stopChat: () => void;
let handlers: Map<string, (params: Record<string, unknown>) => unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  handlers = new Map([
    ['git.diffs', (params) => (params.paths as string[]).map((path) => ({ path, hunks: [hunk] }))],
    ['git.showFile', () => ({ content: 'old\n' })],
    ['file.read', () => ({ content: 'new\n' })],
    ['git.stageHunk', () => ({ success: true })],
    ['git.unstageHunk', () => ({ success: true })],
    [
      'git.status',
      () => ({
        branch: 'feature',
        ahead: 0,
        behind: 0,
        diverged: false,
        files: [],
        hasUncommittedChanges: false,
        hasUntrackedFiles: false,
      }),
    ],
  ]);
  vi.mocked(backendRequest).mockImplementation(async (method, params) => {
    const handler = handlers.get(method);
    if (!handler) throw new Error(`Unexpected mock method ${method}`);
    return handler(params as Record<string, unknown>);
  });
  vi.mocked(invoke).mockImplementation(async (channel) => {
    if (channel === 'git:numstat')
      return { success: true, data: [{ filePath: 'a.ts', additions: 7, deletions: 2 }] };
    throw new Error(`Unexpected mock channel ${channel}`);
  });
  stop = startRootStoreLifecycle(appStore, {
    startSagas: (store) => {
      stopChat = store.runSaga(chatChangesSaga);
      return [stopChat, store.runSaga(gitWriteSaga)];
    },
  });
});
afterEach(async () => {
  stop();
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('chat changes production owners against mock transport', () => {
  it('batches each stage, enriches exact daemon sides, and does not refetch unchanged keys', async () => {
    const value = input([
      change(),
      change('b.ts'),
      change('c.ts', { staged: true, category: 'staged' }),
    ]);
    send(value);
    await vi.runAllTimersAsync();
    expect(calls('git.diffs')).toEqual([
      ['git.diffs', { workspaceId: 'ws', paths: ['a.ts', 'b.ts'] }],
      ['git.diffs', { workspaceId: 'ws', staged: true, paths: ['c.ts'] }],
    ]);
    expect(rows()[0]).toMatchObject({
      oldContent: 'old\n',
      newContent: 'new\n',
      chunks: [hunk],
      isFullFileContent: true,
      additions: 7,
      deletions: 2,
    });
    expect(calls('file.read')).toEqual([
      ['file.read', { workspaceId: 'ws', path: 'a.ts' }],
      ['file.read', { workspaceId: 'ws', path: 'b.ts' }],
    ]);
    expect(consumer()?.status).toBe('ready');
    send(input(value.changes.map((row) => ({ ...row, additions: 99 }))));
    await vi.runAllTimersAsync();
    expect(calls('git.diffs')).toHaveLength(2);
    send(input([]));
    expect(rows()).toEqual([]);
  });

  it('keeps per-turn snippets read-free and uses the owner for aggregate content', async () => {
    const snippet = change('a.ts', { oldContent: 'snippet old', newContent: 'snippet new' });
    send(input([snippet], { showStagingControls: false }));
    await vi.runAllTimersAsync();
    expect(backendRequest).not.toHaveBeenCalled();
    expect(rows()).toEqual([snippet]);
    send(input([{ ...snippet, newContent: 'updated snippet' }], { showStagingControls: false }));
    expect(rows()[0].newContent).toBe('updated snippet');
    send(input([snippet], { showStagingControls: false, isAggregate: true }));
    await vi.runAllTimersAsync();
    expect(calls('git.diffs')).toEqual([['git.diffs', { workspaceId: 'ws', paths: ['a.ts'] }]]);
    expect(rows()[0].newContent).toBe('new\n');
  });

  it('caps single-stage upfront reads at twenty but always enriches merged rows', async () => {
    const singles = Array.from({ length: 22 }, (_, i) => change(`single-${i}.ts`));
    send(
      input([
        ...singles,
        change('merged.ts'),
        change('merged.ts', { staged: true, category: 'staged' }),
      ]),
    );
    await vi.runAllTimersAsync();
    expect(calls('git.diffs')[0][1]).toEqual({
      workspaceId: 'ws',
      paths: [...singles.slice(0, 20).map((row) => row.filePath), 'merged.ts'].sort(),
    });
    expect(calls('git.diffs')[1][1]).toEqual({
      workspaceId: 'ws',
      staged: true,
      paths: ['merged.ts'],
    });
    expect(
      rows()
        .filter((row) => row.filePath === 'merged.ts')
        .every((row) => row.isFullFileContent),
    ).toBe(true);
    expect(
      rows().find((row) => row.filePath === 'single-21.ts')?.isFullFileContent,
    ).toBeUndefined();
  });

  it('scopes committed reads to the secondary root and ref while rejecting a stale result', async () => {
    const old = Promise.withResolvers<{ content: string }>();
    handlers.set('git.showFile', (params) =>
      params.ref === 'old' ? old.promise : { content: 'current' },
    );
    const committed = (hash: string) =>
      input([change('/repo/secondary/a.ts', { category: 'committed', commitHash: hash })], {
        gitRootId: 'root',
        gitRootPath: '/repo/secondary',
      });
    send(committed('old'));
    send(committed('new'));
    await vi.runAllTimersAsync();
    expect(calls('git.showFile')).toContainEqual([
      'git.showFile',
      { workspaceId: 'ws', filePath: 'a.ts', ref: 'new', gitRootId: 'root' },
    ]);
    expect(rows()[0]).toMatchObject({ commitHash: 'new', newContent: 'current' });
    old.resolve({ content: 'stale' });
    await vi.runAllTimersAsync();
    expect(rows()[0].newContent).toBe('current');
  });

  it('collapses repeated committed paths against the branch base and restores per-commit reads on toggle', async () => {
    vi.mocked(invoke).mockImplementation(async (channel) => {
      if (channel === 'git:diff')
        return {
          success: true,
          data: [{ file: 'a.ts', oldContent: 'base', newContent: 'branch', chunks: [hunk] }],
        };
      if (channel === 'git:numstat') return { success: true, data: [] };
      throw new Error(`Unexpected mock channel ${channel}`);
    });
    const commits = [
      change('a.ts', { category: 'committed', commitHash: 'first' }),
      change('a.ts', { category: 'committed', commitHash: 'second' }),
    ];
    send(input(commits, { branchBaseRef: 'main', branchBaseCommitSha: 'base' }));
    await vi.runAllTimersAsync();
    expect(vi.mocked(invoke).mock.calls.filter(([channel]) => channel === 'git:diff')).toEqual([
      [
        'git:diff',
        {
          workspaceId: 'ws',
          paths: ['a.ts'],
          baseRef: 'main',
          baseCommitSha: 'base',
          targetRef: 'HEAD',
        },
      ],
    ]);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      oldContent: 'base',
      newContent: 'branch',
      additions: 1,
      deletions: 1,
    });
    expect(backendRequest).not.toHaveBeenCalled();
    send(
      input(commits, { branchBaseRef: 'main', branchBaseCommitSha: 'base', groupByCommit: true }),
    );
    await vi.runAllTimersAsync();
    expect(rows().map((row) => row.commitHash)).toEqual(['first', 'second']);
    expect(calls('git.showFile')).toEqual([
      ['git.showFile', { workspaceId: 'ws', filePath: 'a.ts', ref: 'first' }],
      ['git.showFile', { workspaceId: 'ws', filePath: 'a.ts', ref: 'first^' }],
      ['git.showFile', { workspaceId: 'ws', filePath: 'a.ts', ref: 'second' }],
      ['git.showFile', { workspaceId: 'ws', filePath: 'a.ts', ref: 'second^' }],
    ]);
  });

  it('isolates consumers and workspaces when a shared read outlives release or unmount', async () => {
    const pending = Promise.withResolvers<unknown>();
    handlers.set('git.diffs', () => pending.promise);
    send(input());
    send(input(), 'ws', 'peer');
    send(input(), 'other');
    await vi.runAllTimersAsync();
    appStore.dispatch(chatChangesConsumerReleased('ws', 'panel'));
    appStore.dispatch(workspaceUnmounted('other'));
    pending.resolve([{ path: 'a.ts', hunks: [hunk] }]);
    await vi.runAllTimersAsync();
    expect(consumer()).toBeUndefined();
    expect(consumer('other')).toBeUndefined();
    expect(rows('ws', 'peer')[0].newContent).toBe('new\n');
    expect(calls('file.read')).toEqual([['file.read', { workspaceId: 'ws', path: 'a.ts' }]]);
  });

  it('coalesces event bursts to one trailing refresh and keeps fresh results during parent refresh', async () => {
    send(input());
    await vi.runAllTimersAsync();
    vi.mocked(backendRequest).mockClear();
    const pending = Promise.withResolvers<unknown>();
    handlers.set('git.diffs', () => pending.promise);
    appStore.dispatch(agentFileRefreshTriggered('ws', 'a.ts'));
    await vi.runAllTimersAsync();
    for (let i = 0; i < 8; i++) appStore.dispatch(agentFileRefreshTriggered('ws', 'a.ts'));
    expect(calls('git.diffs')).toHaveLength(2);
    pending.resolve([{ path: 'a.ts', hunks: [hunk] }]);
    await vi.runAllTimersAsync();
    expect(calls('git.diffs')).toHaveLength(4);
    send(input([change(), change('b.ts')]));
    await vi.runAllTimersAsync();
    expect(calls('git.diffs').slice(4)).toEqual([
      ['git.diffs', { workspaceId: 'ws', paths: ['b.ts'] }],
    ]);
    expect(rows().filter((row) => row.filePath === 'a.ts')).toHaveLength(2);
  });

  it('retries failed enrichment without changing identity', async () => {
    handlers.set('git.diffs', () => {
      throw new Error('read failed');
    });
    send(input());
    await vi.runAllTimersAsync();
    expect(consumer()?.status).toBe('failed');
    handlers.set('git.diffs', () => [{ path: 'a.ts', hunks: [hunk] }]);
    send(input());
    await vi.runAllTimersAsync();
    expect(consumer()?.status).toBe('ready');
    expect(rows()[0].newContent).toBe('new\n');
  });

  it('blocks node-owned reads and hunk intents before a queued batch flush', async () => {
    appStore.dispatch(bulkUpsertSessions([agent(false)]));
    send(input([change()], { agentId: 'agent' }));
    appStore.dispatch(bulkUpsertSessions([agent(true)]));
    appStore.dispatch(
      chatChangesHunkRequested('ws', 'panel', 'remote', 'stageHunk', 'a.ts', patch),
    );
    await vi.runAllTimersAsync();
    expect(backendRequest).not.toHaveBeenCalled();
    send(input([change()], { nodeOwnedPaths: true }));
    await vi.runAllTimersAsync();
    expect(rows()).toEqual([change()]);
  });

  it('retains successful hunk correlation when later file events coalesce over its queued refresh', async () => {
    send(input());
    await vi.runAllTimersAsync();
    const pending = Promise.withResolvers<unknown>();
    handlers.set('git.diffs', () => pending.promise);
    appStore.dispatch(agentFileRefreshTriggered('ws', 'a.ts'));
    await vi.runAllTimersAsync();
    appStore.dispatch(
      chatChangesHunkRequested('ws', 'panel', 'coalesced', 'stageHunk', 'a.ts', patch),
    );
    await vi.runAllTimersAsync();
    appStore.dispatch(agentFileRefreshTriggered('ws', 'a.ts'));
    pending.resolve([{ path: 'a.ts', hunks: [hunk] }]);
    await vi.runAllTimersAsync();
    expect(consumer()?.completedMutationRequestId).toBe('coalesced');
  });

  it('aborts every pending read and clears consumers when the root lifetime stops', async () => {
    const pending = Promise.withResolvers<unknown>();
    handlers.set('git.diffs', () => pending.promise);
    send(input());
    await vi.runAllTimersAsync();
    stopChat();
    pending.resolve([{ path: 'a.ts', hunks: [hunk] }]);
    await vi.runAllTimersAsync();
    expect(consumer()).toBeUndefined();
    expect(calls('file.read')).toEqual([]);
  });

  it.each(['stageHunk', 'unstageHunk'] as const)(
    'routes %s to the production writer and refreshes only after success',
    async (kind) => {
      send(input());
      await vi.runAllTimersAsync();
      vi.mocked(backendRequest).mockClear();
      appStore.dispatch(setAgentLockState('ws', {}, { 'a.ts': true }));
      appStore.dispatch(chatChangesHunkRequested('ws', 'panel', 'locked', kind, 'a.ts', patch));
      await vi.runAllTimersAsync();
      expect(backendRequest).not.toHaveBeenCalled();
      appStore.dispatch(setAgentLockState('ws', {}, {}));
      appStore.dispatch(chatChangesHunkRequested('ws', 'panel', 'success', kind, 'a.ts', patch));
      await vi.runAllTimersAsync();
      expect(calls(`git.${kind}`)).toEqual([
        [`git.${kind}`, { workspaceId: 'ws', filePath: 'a.ts', hunkPatch: patch }],
      ]);
      expect(consumer()?.completedMutationRequestId).toBe('success');
      expect(calls('git.diffs')).toHaveLength(2);
      handlers.set(`git.${kind}`, () => {
        throw new Error('conflict');
      });
      appStore.dispatch(chatChangesHunkRequested('ws', 'panel', 'failure', kind, 'a.ts', patch));
      await vi.runAllTimersAsync();
      expect(calls('git.diffs')).toHaveLength(2);
      expect(consumer()?.completedMutationRequestId).toBe('success');
    },
  );
});
