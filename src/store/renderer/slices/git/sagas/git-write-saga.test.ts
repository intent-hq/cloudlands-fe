import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendRequest } from '$lib/client/live/backend-transport';
import { invoke } from '$lib/electron-bridge';
import { SYSTEM_CHANNELS } from '$shared/ipc/channels';
import { notify } from '$lib/components/patterns/notify';
import {
  AgentStatus,
  GitFileStatus,
  type GitStatus,
  type AgentSession,
  type Workspace,
} from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { agentSessionReducer, bulkUpsertSessions } from '../../agent-session/agent-session-slice';
import { reserveGitMutation } from '../../../utils/worktree-mutation-queue';
import { fileTrackingReducer, setChanges } from '../../changes/changes-slice';
import { selectFileTrackingChanges } from '../../changes/changes-selectors';
import { ChangeStage } from '$features/file-tracking/types';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { workspaceReducer, setWorkspaceEntity } from '../../workspace/workspace-slice';
import { gitReducer, setGitStatus } from '../git-slice';
import {
  gitWriteReducer,
  gitWriteRequested,
  cancelQueuedGitWrite,
  gitWriteConsumerReleased,
  gitWriteFinished,
} from '../git-write-slice';
import { selectGitWriteOperation } from '../git-write-selectors';
import { gitWriteSaga } from './git-write-saga';

vi.mock('$lib/client/live/backend-transport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/client/live/backend-transport')>()),
  backendRequest: vi.fn(),
}));
vi.mock('$lib/client', async () => {
  const { LiveGitClient } = await import('$lib/client/live/live-git-client');
  return { appClient: { git: new LiveGitClient() } };
});
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock('$lib/electron-bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/electron-bridge')>()),
  invoke: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const status = (files: GitStatus['files'] = []): GitStatus => ({
  branch: 'branch',
  ahead: 0,
  behind: 0,
  diverged: false,
  files,
  hasUncommittedChanges: files.length > 0,
  hasUntrackedFiles: false,
});
const file = (path: string, staged = false) => ({ path, staged, status: GitFileStatus.Modified });
const tasks: ReturnType<typeof runSaga>[] = [];
type Action = Parameters<typeof gitWriteReducer>[1];

function startWrites(onAction?: (action: Action) => void) {
  const channel = stdChannel();
  const initial = { type: 'test/init' };
  let state = {
    gitWrite: gitWriteReducer(undefined, initial),
    git: gitReducer(undefined, initial),
    changes: fileTrackingReducer(undefined, initial),
    agentLock: { byWorkspaceId: {} },
    agentSessions: agentSessionReducer(undefined, initial),
    workspace: workspaceReducer(undefined, initial),
  };
  const actions: Action[] = [];
  const dispatch = (action: Action) => {
    onAction?.(action);
    state = {
      ...state,
      gitWrite: gitWriteReducer(state.gitWrite, action),
      git: gitReducer(state.git, action),
      changes: fileTrackingReducer(state.changes, action),
      agentSessions: agentSessionReducer(state.agentSessions, action),
      workspace: workspaceReducer(state.workspace, action),
    };
    actions.push(action);
    channel.put(action);
    return action;
  };
  const task = runSaga({ channel, dispatch, getState: () => state }, gitWriteSaga);
  tasks.push(task);
  return { dispatch, task, actions, state: () => state };
}

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue({ success: true });
  vi.mocked(backendRequest)
    .mockReset()
    .mockImplementation(async (method) => {
      if (method === 'git.status') return status();
      if (method === 'accept-changes.execute') return { success: true, steps: [] };
      return { ok: true };
    });
});
afterEach(() => {
  for (const task of tasks.splice(0)) task.cancel();
  vi.clearAllMocks();
});

describe('gitWriteSaga with protocol transports', () => {
  it('amends with a literal quoted message and workspace-contained IPC payload', async () => {
    const owner = startWrites();
    const request = gitWriteRequested('amend', 'one', {
      kind: 'amend',
      message: "fix: `echo nope` $(whoami) and 'quote'",
      cwd: '/repo',
      source: 'timeline',
    });
    owner.dispatch(request);
    await expect(request.promise).resolves.toEqual({ success: true });
    expect(invoke).toHaveBeenCalledExactlyOnceWith(SYSTEM_CHANNELS.EXECUTE_COMMAND, {
      command: "git commit --amend -m 'fix: `echo nope` $(whoami) and '\\''quote'\\'''",
      cwd: '/repo',
      workspaceId: 'amend',
    });
    expect(notify.success).toHaveBeenCalledTimes(1);
  });

  it('keeps the pushed amend upstream fallback inside the Git transaction', async () => {
    const push = deferred<{ success: boolean }>();
    vi.mocked(invoke)
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, data: { stderr: 'fatal: has no upstream branch' } })
      .mockResolvedValueOnce({ success: true, data: { stdout: 'feature/branch\n' } })
      .mockReturnValueOnce(push.promise);
    const owner = startWrites();
    const request = gitWriteRequested('amend-push', 'one', {
      kind: 'amend',
      message: 'updated',
      cwd: '/repo',
      wasPushed: true,
      source: 'timeline',
    });
    const next = gitWriteRequested('amend-push', 'next', { kind: 'stage', paths: ['later.ts'] });
    owner.dispatch(request);
    owner.dispatch(next);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(4));
    expect(vi.mocked(invoke).mock.calls).toEqual([
      [
        SYSTEM_CHANNELS.EXECUTE_COMMAND,
        { command: "git commit --amend -m 'updated'", cwd: '/repo', workspaceId: 'amend-push' },
      ],
      [
        SYSTEM_CHANNELS.EXECUTE_COMMAND,
        { command: 'git push --force-with-lease', cwd: '/repo', workspaceId: 'amend-push' },
      ],
      [
        SYSTEM_CHANNELS.EXECUTE_COMMAND,
        { command: 'git rev-parse --abbrev-ref HEAD', cwd: '/repo', workspaceId: 'amend-push' },
      ],
      [
        SYSTEM_CHANNELS.EXECUTE_COMMAND,
        {
          command: 'git push --force-with-lease --set-upstream origin feature/branch',
          cwd: '/repo',
          workspaceId: 'amend-push',
        },
      ],
    ]);
    expect(backendRequest).not.toHaveBeenCalledWith('git.stage', expect.anything());
    push.resolve({ success: true });
    await expect(request.promise).resolves.toEqual({ success: true });
    await expect(next.promise).resolves.toEqual({ success: true });
  });

  it.each(['amend', 'push'])(
    'settles %s IPC failure and reports failure without success toast',
    async (step) => {
      const owner = startWrites();
      if (step === 'push') vi.mocked(invoke).mockResolvedValueOnce({ success: true });
      vi.mocked(invoke).mockResolvedValueOnce({ success: false, error: 'denied' });
      const request = gitWriteRequested('amend-fail', step, {
        kind: 'amend',
        message: 'updated',
        cwd: '/repo',
        wasPushed: true,
        source: 'timeline',
      });
      owner.dispatch(request);
      await expect(request.promise).resolves.toEqual({ success: false, error: 'denied' });
      expect(
        selectGitWriteOperation.select(owner.state() as never, 'amend-fail', step)?.status,
      ).toBe('failed');
      expect(notify.error).toHaveBeenCalledTimes(1);
      expect(notify.success).not.toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledTimes(step === 'amend' ? 1 : 2);
    },
  );

  it('sends exact stage payload and converges status and changes before settlement', async () => {
    const owner = startWrites();
    owner.dispatch(setGitStatus('ws-a', status([file('a.ts')])));
    owner.dispatch(
      setChanges('ws-a', [
        {
          id: 'a',
          file: 'a.ts',
          relativePath: 'a.ts',
          stage: ChangeStage.Unstaged,
          stats: { additions: 2, deletions: 1 },
          attribution: { manual: true, timestamp: 1 },
        },
      ]),
    );
    vi.mocked(backendRequest).mockImplementation(async (method) =>
      method === 'git.status' ? status([file('a.ts', true)]) : { ok: true },
    );
    const request = gitWriteRequested('ws-a', 'stage', {
      kind: 'stage',
      paths: ['a.ts'],
      openDiff: true,
    });
    owner.dispatch(request);
    await expect(request.promise).resolves.toEqual({ success: true });
    expect(backendRequest).toHaveBeenCalledWith('git.stage', {
      workspaceId: 'ws-a',
      paths: ['a.ts'],
    });
    expect(backendRequest).toHaveBeenCalledWith('git.status', {
      workspaceId: 'ws-a',
      forceRefresh: true,
    });
    expect(selectFileTrackingChanges.select(owner.state() as never, 'ws-a')).toMatchObject([
      { relativePath: 'a.ts', stage: ChangeStage.Staged, stats: { additions: 2, deletions: 1 } },
    ]);
    expect(owner.actions).toContainEqual(
      expect.objectContaining({
        type: 'workspaceNavigation/openWorkspaceDiff',
        payload: [
          'ws-a',
          expect.objectContaining({ relativePath: 'a.ts', stage: ChangeStage.Staged }),
          expect.objectContaining({ forceUpdate: true }),
        ],
      }),
    );
  });

  it('serializes same-workspace writes and lets another workspace progress during transport failure', async () => {
    const held = deferred<{ ok: boolean; error?: string }>();
    const owner = startWrites();
    owner.dispatch(setGitStatus('ws-a', status([file('a.ts')])));
    vi.mocked(backendRequest).mockImplementation(async (method, params) => {
      if (method === 'git.stage' && params?.workspaceId === 'ws-a') {
        await held.promise;
        throw new Error('denied');
      }
      if (method === 'git.status') return status([file('a.ts')]);
      return { ok: true };
    });
    const first = gitWriteRequested('ws-a', 'first', { kind: 'stage', paths: ['a.ts'] });
    const next = gitWriteRequested('ws-a', 'next', { kind: 'discard', paths: ['b.ts'] });
    const other = gitWriteRequested('ws-b', 'other', { kind: 'stage', paths: ['c.ts'] });
    owner.dispatch(first);
    owner.dispatch(next);
    owner.dispatch(other);
    await other.promise;
    expect(backendRequest).not.toHaveBeenCalledWith('git.discard', expect.anything());
    held.resolve({ ok: false, error: 'denied' });
    await expect(first.promise).resolves.toMatchObject({ success: false });
    await expect(next.promise).resolves.toEqual({ success: true });
    expect(selectGitWriteOperation.select(owner.state() as never, 'ws-a', 'first')?.status).toBe(
      'failed',
    );
  });

  it.each(['git.unstage', 'git.stage', 'accept-changes.execute'])(
    'restores original staging after %s failure inside one transaction',
    async (failureMethod) => {
      const owner = startWrites();
      let failed = false;
      vi.mocked(backendRequest).mockImplementation(async (method) => {
        if (method === 'git.status') return status([file('target.ts'), file('other.ts', true)]);
        if (method === failureMethod && !failed) {
          failed = true;
          throw new Error('denied');
        }
        return method === 'accept-changes.execute' ? { success: true, steps: [] } : { ok: true };
      });
      const request = gitWriteRequested('partial', failureMethod, {
        kind: 'partialCommit',
        paths: ['target.ts'],
        section: 'unstaged',
        message: 'target only',
      });
      owner.dispatch(request);
      await expect(request.promise).resolves.toEqual({ success: false, error: 'denied' });
      expect(backendRequest).toHaveBeenCalledWith('git.unstage', {
        workspaceId: 'partial',
        paths: ['target.ts'],
      });
      expect(backendRequest).toHaveBeenLastCalledWith('git.status', {
        workspaceId: 'partial',
        forceRefresh: true,
      });
      const mutations = vi
        .mocked(backendRequest)
        .mock.calls.filter(([method]) => method !== 'git.status');
      expect(mutations.at(-1)).toEqual([
        'git.stage',
        { workspaceId: 'partial', paths: ['other.ts'] },
      ]);
    },
  );

  it('holds queued writes until successful partial commit and restoration finish', async () => {
    const commit = deferred<{ success: boolean; steps: [] }>();
    const owner = startWrites();
    vi.mocked(backendRequest).mockImplementation(async (method) => {
      if (method === 'git.status') return status([file('target.ts'), file('other.ts', true)]);
      if (method === 'accept-changes.execute') return commit.promise;
      return { ok: true };
    });
    const request = gitWriteRequested('partial-ok', 'commit', {
      kind: 'partialCommit',
      paths: ['target.ts'],
      section: 'unstaged',
      message: 'target only',
    });
    const next = gitWriteRequested('partial-ok', 'next', { kind: 'discard', paths: ['later.ts'] });
    owner.dispatch(request);
    owner.dispatch(next);
    await vi.waitFor(() =>
      expect(backendRequest).toHaveBeenCalledWith('accept-changes.execute', {
        workspaceId: 'partial-ok',
        action: 'commit',
        commitMessage: 'target only',
        files: undefined,
        prTitle: undefined,
        prBody: undefined,
        targetBranch: undefined,
        mergeStrategy: undefined,
        upToCommitHash: undefined,
        undoCommitsMetadata: undefined,
        options: {
          stageUnstaged: undefined,
          pushAfterCommit: undefined,
          createPRAfterPush: undefined,
          rebaseFirst: undefined,
          localOnly: undefined,
        },
      }),
    );
    expect(backendRequest).not.toHaveBeenCalledWith('git.discard', expect.anything());
    commit.resolve({ success: true, steps: [] });
    await request.promise;
    await next.promise;
    expect(
      vi
        .mocked(backendRequest)
        .mock.calls.filter(([method]) => method !== 'git.status')
        .map(([method, params]) => [method, params?.paths]),
    ).toEqual([
      ['git.unstage', ['other.ts']],
      ['git.stage', ['target.ts']],
      ['accept-changes.execute', undefined],
      ['git.stage', ['other.ts']],
      ['git.discard', ['later.ts']],
    ]);
  });

  it('preserves restoration transport tails when the saga owner is cancelled mid-commit', async () => {
    const commit = deferred<{ success: boolean; steps: [] }>();
    const restore = deferred<{ ok: boolean }>();
    const owner = startWrites();
    vi.mocked(backendRequest).mockImplementation(async (method, params) => {
      if (method === 'git.status') return status([file('target.ts'), file('other.ts', true)]);
      if (method === 'accept-changes.execute') return commit.promise;
      if (method === 'git.stage' && (params?.paths as string[])?.[0] === 'other.ts')
        return restore.promise;
      return { ok: true };
    });
    const request = gitWriteRequested('cancel-partial', 'commit', {
      kind: 'partialCommit',
      paths: ['target.ts'],
      section: 'unstaged',
      message: 'target only',
    });
    owner.dispatch(request);
    await vi.waitFor(() =>
      expect(backendRequest).toHaveBeenCalledWith('accept-changes.execute', expect.anything()),
    );
    owner.task.cancel();
    await expect(request.promise).rejects.toBeInstanceOf(Error);
    const next = reserveGitMutation('cancel-partial');
    const transport = vi.fn(async () => undefined);
    const result = next.run(transport);
    commit.resolve({ success: true, steps: [] });
    await vi.waitFor(() =>
      expect(backendRequest).toHaveBeenCalledWith('git.stage', {
        workspaceId: 'cancel-partial',
        paths: ['other.ts'],
      }),
    );
    expect(transport).not.toHaveBeenCalled();
    restore.resolve({ ok: true });
    await result;
    await next.release();
  });

  it('cancels a queued group without writing', async () => {
    const held = reserveGitMutation('cancel-queued');
    const owner = startWrites();
    const queued = gitWriteRequested('cancel-queued', 'queued', {
      kind: 'partialCommit',
      paths: ['a.ts'],
      section: 'unstaged',
      message: 'a',
    });
    owner.dispatch(queued);
    owner.dispatch(cancelQueuedGitWrite('cancel-queued', 'queued'));
    await held.release();
    await queued.promise;
    expect(backendRequest).not.toHaveBeenCalled();
  });

  const rawPatches = [
    [
      'text',
      'diff --git a/other.ts b/other.ts\nindex 3367afdbbf91e638efe983616377c60477cc6612..3e757656cf36eca53338e520d134963a44f793f8 100644\n--- a/other.ts\n+++ b/other.ts\n@@ -1 +1 @@\n-old\n+new\n',
    ],
    [
      'no-final-newline',
      'diff --git a/other.ts b/other.ts\n--- a/other.ts\n+++ b/other.ts\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n',
    ],
    [
      'binary',
      'diff --git a/other.ts b/other.ts\nindex 8b137891791fe96927ad78e64b0aad7bded08bdc..e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 100644\nGIT binary patch\nliteral 0\nHcmV?d00001\n\nliteral 1\nIcmd;L000310RR91\n\n',
    ],
  ];

  it.each(rawPatches)(
    'replays unrelated %s index data unchanged, without staging its working-tree content',
    async (_label, patch) => {
      const owner = startWrites();
      owner.dispatch(
        setWorkspaceEntity({
          id: WorkspaceId('partial-index'),
          worktreePath: '/repo',
          repositoryPath: '/original',
        } as Workspace),
      );
      vi.mocked(backendRequest).mockImplementation(async (method) => {
        if (method === 'git.status')
          return status([file('other.ts', true), file('other.ts'), file('target.ts')]);
        if (method === 'host.exec') return { stdout: patch, stderr: '', exitCode: 0 };
        if (method === 'accept-changes.execute') return { success: true, steps: [] };
        return { ok: true };
      });
      const request = gitWriteRequested('partial-index', 'commit', {
        kind: 'partialCommit',
        paths: ['target.ts'],
        section: 'unstaged',
        message: 'target',
      });
      owner.dispatch(request);
      await expect(request.promise).resolves.toEqual({ success: true });
      expect(backendRequest).toHaveBeenCalledWith('host.exec', {
        workspaceId: 'partial-index',
        cwd: '/repo',
        command: 'git',
        args: [
          '--literal-pathspecs',
          '-c',
          'core.quotePath=false',
          'diff',
          '--cached',
          '--binary',
          '--full-index',
          '--no-ext-diff',
          '--no-textconv',
          '--no-renames',
          '--no-color',
          '--no-relative',
          '--src-prefix=a/',
          '--dst-prefix=b/',
          '--',
          'other.ts',
        ],
        timeoutMs: 30_000,
      });
      expect(backendRequest).toHaveBeenCalledWith('git.stageHunk', {
        workspaceId: 'partial-index',
        filePath: 'other.ts',
        hunkPatch: patch,
      });
      expect(
        vi.mocked(backendRequest).mock.calls.filter(([method]) => method === 'git.stage'),
      ).toEqual([['git.stage', { workspaceId: 'partial-index', paths: ['target.ts'] }]]);
      expect(JSON.stringify(owner.state())).not.toContain(JSON.stringify(patch).slice(1, -1));
    },
  );

  it.each(['git.unstage', 'git.stage', 'accept-changes.execute'])(
    'restores target and unrelated partial indexes after %s fails',
    async (failureMethod) => {
      const owner = startWrites();
      const otherPatch = rawPatches[0][1];
      const targetPatch = otherPatch.replaceAll('other.ts', 'target.ts');
      let failed = false;
      vi.mocked(backendRequest).mockImplementation(async (method, params) => {
        if (method === 'git.status')
          return status([
            file('other.ts', true),
            file('other.ts'),
            file('target.ts', true),
            file('target.ts'),
          ]);
        if (method === 'host.exec')
          return {
            stdout: (params?.args as string[]).at(-1) === 'other.ts' ? otherPatch : targetPatch,
            stderr: '',
            exitCode: 0,
          };
        if (method === failureMethod && !failed) {
          failed = true;
          throw new Error('denied');
        }
        return { ok: true };
      });
      const request = gitWriteRequested('partial-fail', failureMethod, {
        kind: 'partialCommit',
        paths: ['target.ts'],
        section: 'unstaged',
        message: 'target',
      });
      owner.dispatch(request);
      await expect(request.promise).resolves.toEqual({ success: false, error: 'denied' });
      for (const [filePath, hunkPatch] of [
        ['other.ts', otherPatch],
        ['target.ts', targetPatch],
      ]) {
        expect(backendRequest).toHaveBeenCalledWith('git.stageHunk', {
          workspaceId: 'partial-fail',
          filePath,
          hunkPatch,
        });
      }
      expect(backendRequest).not.toHaveBeenCalledWith('git.stage', {
        workspaceId: 'partial-fail',
        paths: ['other.ts'],
      });
      const writes = vi
        .mocked(backendRequest)
        .mock.calls.filter(([method]) => method !== 'git.status');
      expect(writes.slice(0, 2).map(([method]) => method)).toEqual(['host.exec', 'host.exec']);
    },
  );

  it.each(['staged', 'unstaged'] as const)(
    'does not restore committed target content for a successful %s group',
    async (section) => {
      const owner = startWrites();
      const patch = rawPatches[0][1].replaceAll('other.ts', 'target.ts');
      vi.mocked(backendRequest).mockImplementation(async (method) => {
        if (method === 'git.status') return status([file('target.ts', true), file('target.ts')]);
        if (method === 'host.exec') return { stdout: patch, stderr: '', exitCode: 0 };
        if (method === 'accept-changes.execute') return { success: true, steps: [] };
        return { ok: true };
      });
      const request = gitWriteRequested('partial-target', 'commit', {
        kind: 'partialCommit',
        paths: ['target.ts'],
        section,
        message: 'target',
      });
      owner.dispatch(request);
      await expect(request.promise).resolves.toEqual({ success: true });
      expect(backendRequest).not.toHaveBeenCalledWith('git.stageHunk', expect.anything());
      expect(backendRequest).not.toHaveBeenCalledWith('git.unstage', expect.anything());
      if (section === 'staged') {
        expect(backendRequest).not.toHaveBeenCalledWith('git.stage', expect.anything());
        expect(backendRequest).not.toHaveBeenCalledWith('host.exec', expect.anything());
      } else {
        expect(backendRequest).toHaveBeenCalledWith('git.stage', {
          workspaceId: 'partial-target',
          paths: ['target.ts'],
        });
      }
    },
  );

  it('preserves the successful commit and warns separately when index restoration fails', async () => {
    const owner = startWrites();
    vi.mocked(backendRequest).mockImplementation(async (method) => {
      if (method === 'git.status')
        return status([file('other.ts', true), file('other.ts'), file('target.ts')]);
      if (method === 'host.exec') return { stdout: rawPatches[0][1], stderr: '', exitCode: 0 };
      if (method === 'accept-changes.execute') return { success: true, steps: [] };
      if (method === 'git.stageHunk') throw new Error('index restoration failed');
      return { ok: true };
    });
    const request = gitWriteRequested('restore-fail', 'commit', {
      kind: 'partialCommit',
      paths: ['target.ts'],
      section: 'unstaged',
      message: 'target',
      source: 'sidebar',
    });
    owner.dispatch(request);
    await expect(request.promise).resolves.toEqual({
      success: true,
      error: 'index restoration failed',
    });
    expect(
      selectGitWriteOperation.select(owner.state() as never, 'restore-fail', 'commit')?.status,
    ).toBe('succeeded');
    expect(
      vi
        .mocked(backendRequest)
        .mock.calls.filter(([method]) => method === 'accept-changes.execute'),
    ).toHaveLength(1);
    expect(notify.warning).toHaveBeenCalledExactlyOnceWith(expect.any(String), {
      description: 'index restoration failed',
    });
    expect(notify.error).not.toHaveBeenCalled();
    expect(notify.success).not.toHaveBeenCalled();
  });

  it('finishes partial-index restoration after unmount without recreating state or publishing a warning', async () => {
    const owner = startWrites();
    const restore = deferred<void>();
    vi.mocked(backendRequest).mockImplementation(async (method) => {
      if (method === 'git.status')
        return status([file('other.ts', true), file('other.ts'), file('target.ts')]);
      if (method === 'host.exec') return { stdout: rawPatches[0][1], stderr: '', exitCode: 0 };
      if (method === 'accept-changes.execute') return { success: true, steps: [] };
      if (method === 'git.stageHunk') {
        await restore.promise;
        throw new Error('index restoration failed');
      }
      return { ok: true };
    });
    const request = gitWriteRequested('unmounted-partial', 'commit', {
      kind: 'partialCommit',
      paths: ['target.ts'],
      section: 'unstaged',
      message: 'target',
      source: 'sidebar',
    });
    owner.dispatch(request);
    await vi.waitFor(() =>
      expect(backendRequest).toHaveBeenCalledWith('git.stageHunk', expect.anything()),
    );
    owner.dispatch(workspaceUnmounted('unmounted-partial'));
    restore.resolve();
    await expect(request.promise).resolves.toEqual({
      success: true,
      error: 'index restoration failed',
    });
    expect(owner.state().gitWrite.byWorkspaceId['unmounted-partial']).toBeUndefined();
    expect(notify.warning).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
    expect(notify.success).not.toHaveBeenCalled();
  });

  it.each([
    { stdout: '', stderr: 'failed', exitCode: 1 },
    { stdout: rawPatches[0][1], stderr: '', exitCode: 0, timedOut: true },
    { stdout: 'unusable patch', stderr: '', exitCode: 0 },
  ])('fails snapshot capture before any mutation: %j', async (snapshot) => {
    const owner = startWrites();
    vi.mocked(backendRequest).mockImplementation(async (method) =>
      method === 'host.exec'
        ? snapshot
        : status([file('other.ts', true), file('other.ts'), file('target.ts')]),
    );
    const request = gitWriteRequested('snapshot-fail', 'commit', {
      kind: 'partialCommit',
      paths: ['target.ts'],
      section: 'unstaged',
      message: 'target',
    });
    owner.dispatch(request);
    await expect(request.promise).resolves.toMatchObject({ success: false });
    expect(
      vi
        .mocked(backendRequest)
        .mock.calls.every(([method]) => method === 'git.status' || method === 'host.exec'),
    ).toBe(true);
  });

  it('keeps raw patch restoration under the lease after cancellation and attempts remaining paths on restore failure', async () => {
    const owner = startWrites();
    const commit = deferred<{ success: boolean; steps: [] }>();
    const restore = deferred<{ ok: boolean }>();
    const patch = rawPatches[0][1];
    vi.mocked(backendRequest).mockImplementation(async (method, params) => {
      if (method === 'git.status')
        return status([
          file('other.ts', true),
          file('other.ts'),
          file('last.ts', true),
          file('last.ts'),
          file('target.ts'),
        ]);
      if (method === 'host.exec')
        return {
          stdout: patch.replaceAll('other.ts', (params?.args as string[]).at(-1)!),
          stderr: '',
          exitCode: 0,
        };
      if (method === 'accept-changes.execute') return commit.promise;
      if (method === 'git.stageHunk' && params?.filePath === 'other.ts') {
        await restore.promise;
        throw new Error('restore failed');
      }
      return { ok: true };
    });
    const request = gitWriteRequested('cancel-raw', 'commit', {
      kind: 'partialCommit',
      paths: ['target.ts'],
      section: 'unstaged',
      message: 'target',
    });
    owner.dispatch(request);
    await vi.waitFor(() =>
      expect(backendRequest).toHaveBeenCalledWith('accept-changes.execute', expect.anything()),
    );
    owner.task.cancel();
    await expect(request.promise).rejects.toBeInstanceOf(Error);
    const next = reserveGitMutation('cancel-raw');
    const transport = vi.fn(async () => undefined);
    const result = next.run(transport);
    commit.resolve({ success: true, steps: [] });
    await vi.waitFor(() =>
      expect(backendRequest).toHaveBeenCalledWith('git.stageHunk', {
        workspaceId: 'cancel-raw',
        filePath: 'other.ts',
        hunkPatch: patch,
      }),
    );
    expect(transport).not.toHaveBeenCalled();
    restore.resolve({ ok: true });
    await result;
    await next.release();
    expect(backendRequest).toHaveBeenCalledWith('git.stageHunk', {
      workspaceId: 'cancel-raw',
      filePath: 'last.ts',
      hunkPatch: patch.replaceAll('other.ts', 'last.ts'),
    });
  });

  it.each(['stageHunk', 'unstageHunk'] as const)(
    'owns %s transport and publishes correlated completion after status refresh',
    async (kind) => {
      const owner = startWrites();
      const operation = {
        kind,
        filePath: 'a.ts',
        hunkPatch: '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n',
        source: 'chat' as const,
        consumerId: 'chat-1',
      };
      const request = gitWriteRequested('hunks', kind, operation);
      owner.dispatch(request);
      await request.promise;
      expect(backendRequest).toHaveBeenCalledWith(`git.${kind}`, {
        workspaceId: 'hunks',
        filePath: 'a.ts',
        hunkPatch: operation.hunkPatch,
      });
      expect(owner.actions).toContainEqual(
        gitWriteFinished('hunks', kind, { success: true }, operation),
      );
      expect(notify.success).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['workspace', 'consumer'])(
    'does not recreate released %s state or publish late UI effects',
    async (release) => {
      const held = deferred<{ ok: boolean }>();
      const owner = startWrites();
      vi.mocked(backendRequest).mockImplementation(async (method) =>
        method === 'git.stage' ? held.promise : status([file('a.ts', true)]),
      );
      const request = gitWriteRequested('release', 'write', {
        kind: 'stage',
        paths: ['a.ts'],
        source: 'sidebar',
        consumerId: 'panel',
        openDiff: true,
      });
      owner.dispatch(request);
      await vi.waitFor(() =>
        expect(backendRequest).toHaveBeenCalledWith('git.stage', expect.anything()),
      );
      owner.dispatch(
        release === 'workspace'
          ? workspaceUnmounted('release')
          : gitWriteConsumerReleased('release', 'panel'),
      );
      const boundary = owner.actions.length;
      held.resolve({ ok: true });
      await request.promise;
      expect(
        selectGitWriteOperation.select(owner.state() as never, 'release', 'write'),
      ).toBeUndefined();
      expect(owner.actions.slice(boundary).map((action) => action.type)).not.toContain(
        setGitStatus.type,
      );
      expect(notify.success).not.toHaveBeenCalled();
      expect(notify.error).not.toHaveBeenCalled();
    },
  );

  it('does not write to the head workspace when a queued source agent moves to a remote node', async () => {
    const held = reserveGitMutation('remote');
    const owner = startWrites();
    const agent: AgentSession = {
      id: AgentId('source-agent'),
      workspaceId: WorkspaceId('remote'),
      backendSessionId: null,
      name: 'Source',
      status: AgentStatus.Idle,
      messages: [],
      createdAt: '2026-09-29T00:00:00Z',
      updatedAt: '2026-09-29T00:00:00Z',
    };
    owner.dispatch(bulkUpsertSessions([agent]));
    const request = gitWriteRequested('remote', 'hunk', {
      kind: 'stageHunk',
      filePath: 'a.ts',
      hunkPatch: '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n',
      source: 'chat',
      sourceAgentId: agent.id,
    });
    owner.dispatch(request);
    owner.dispatch(
      bulkUpsertSessions([
        {
          ...agent,
          placement: {
            target: 'remote',
            checkout: 'isolated',
            os: 'linux',
            nodeId: 'node-build',
            exclusive: true,
          },
        },
      ]),
    );
    await held.release();
    await expect(request.promise).resolves.toMatchObject({ success: false });
    expect(backendRequest).not.toHaveBeenCalled();
    expect(selectGitWriteOperation.select(owner.state() as never, 'remote', 'hunk')?.status).toBe(
      'failed',
    );
  });

  it('settles an applied mutation and keeps the watcher alive when notification fails', async () => {
    const owner = startWrites();
    vi.mocked(notify.success).mockImplementationOnce(() => {
      throw new Error('toast unavailable');
    });
    const request = gitWriteRequested('toast', 'hunk', {
      kind: 'stageHunk',
      filePath: 'a.ts',
      hunkPatch: '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n',
      source: 'chat',
    });
    owner.dispatch(request);
    await expect(request.promise).resolves.toEqual({ success: true });
    expect(selectGitWriteOperation.select(owner.state() as never, 'toast', 'hunk')?.status).toBe(
      'succeeded',
    );
    const next = gitWriteRequested('toast', 'next', { kind: 'stage', paths: ['b.ts'] });
    owner.dispatch(next);
    await expect(next.promise).resolves.toEqual({ success: true });
  });

  it('settles an applied mutation when diff navigation throws', async () => {
    const owner = startWrites((action) => {
      if (action.type === 'workspaceNavigation/openWorkspaceDiff')
        throw new Error('panel unavailable');
    });
    vi.mocked(backendRequest).mockImplementation(async (method) =>
      method === 'git.status' ? status([file('a.ts', true)]) : { ok: true },
    );
    const request = gitWriteRequested('navigation', 'stage', {
      kind: 'stage',
      paths: ['a.ts'],
      openDiff: true,
    });
    owner.dispatch(request);
    await expect(request.promise).resolves.toEqual({ success: true });
    expect(
      selectGitWriteOperation.select(owner.state() as never, 'navigation', 'stage')?.status,
    ).toBe('succeeded');
    expect(owner.task.isRunning()).toBe(true);
  });
});
