import { runSaga } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isElectron: vi.fn(() => true),
  invoke: vi.fn(),
  navigateToRoute: vi.fn(async () => undefined),
  list: vi.fn(),
  create: vi.fn(),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

vi.mock('$lib/electron-bridge', () => ({ isElectron: mocks.isElectron, invoke: mocks.invoke }));
vi.mock('$lib/utils/navigation.client', () => ({ navigateToRoute: mocks.navigateToRoute }));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ warn: vi.fn(), debug: vi.fn(), info: vi.fn() }),
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: mocks.notifyError, success: mocks.notifySuccess },
}));
vi.mock('../../workspace/utils/workspace.client', () => ({
  workspaceClient: { list: mocks.list, create: mocks.create },
}));

import type { Workspace } from '$shared/types';
import { setShowCreateModal } from '../../sidebar-nav/sidebar-nav-slice';
import { openWorkspaceTab } from '../../tab-state/tab-state-slice';
import { setUpdateChannel } from '../../user-preferences/user-preferences-slice';
import { setWorkspaceEntity } from '../../workspace/workspace-slice';
import type { DeepLinkActionPayload } from '../deep-links-types';
import { deepLinksSaga, drainPendingDeepLinks, handleDeepLinkAction } from './deep-links-saga';

function workspace(overrides: Partial<Workspace>): Workspace {
  return {
    id: 'ws-1',
    title: 'Workspace',
    status: 'Active',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  } as Workspace;
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

async function run(action: DeepLinkActionPayload) {
  const dispatched: unknown[] = [];
  await runSaga(
    { dispatch: (a) => dispatched.push(a), getState: () => ({}) },
    handleDeepLinkAction,
    action,
  ).toPromise();
  return dispatched;
}

beforeEach(() => {
  sessionStorage.clear();
  mocks.list.mockResolvedValue({ ok: true, data: [] });
  mocks.isElectron.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('intent://open?path (the intent CLI)', () => {
  it('opens the workspace already working in the folder and creates nothing', async () => {
    mocks.list.mockResolvedValue({
      ok: true,
      data: [
        workspace({ id: 'other', repositoryPath: '/Users/me/other' }),
        workspace({ id: 'home', repositoryPath: '/Users/me', skipWorktree: true }),
      ],
    });
    const dispatched = await run({ type: 'open', params: { path: '/Users/me/' } });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(dispatched).toContainEqual(openWorkspaceTab('home'));
    expect(mocks.navigateToRoute).toHaveBeenCalledWith('/workspace/home');
  });

  it('matches a worktree workspace by its worktree folder', async () => {
    mocks.list.mockResolvedValue({
      ok: true,
      data: [
        workspace({
          id: 'wt',
          repositoryPath: '/Users/me/repo',
          worktreePath: '/Users/me/intent/workspaces/wt/repo',
        }),
      ],
    });
    await run({ type: 'open', params: { path: '/Users/me/intent/workspaces/wt/repo' } });
    expect(mocks.navigateToRoute).toHaveBeenCalledWith('/workspace/wt');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('creates a no-worktree workspace on the folder when none exists, then opens it', async () => {
    const created = workspace({ id: 'new-ws', repositoryPath: '/Users/me', skipWorktree: true });
    mocks.create.mockResolvedValue({ ok: true, data: { workspace: created } });
    const dispatched = await run({ type: 'open', params: { path: '/Users/me' } });
    expect(mocks.list).toHaveBeenCalledWith({ lite: true });
    expect(mocks.create).toHaveBeenCalledWith({
      title: 'me',
      repositoryPath: '/Users/me',
      skipIsolation: true,
    });
    expect(dispatched).toContainEqual(setWorkspaceEntity(created));
    expect(dispatched).toContainEqual(openWorkspaceTab('new-ws'));
    expect(mocks.navigateToRoute).toHaveBeenCalledWith('/workspace/new-ws');
  });

  it('creates a fresh workspace when the only match is archived', async () => {
    mocks.list.mockResolvedValue({
      ok: true,
      data: [workspace({ id: 'old', repositoryPath: '/Users/me', archived: true })],
    });
    mocks.create.mockResolvedValue({ ok: true, data: { workspace: workspace({ id: 'fresh' }) } });
    await run({ type: 'open', params: { path: '/Users/me' } });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.navigateToRoute).toHaveBeenCalledWith('/workspace/fresh');
  });

  it('shows an error naming the folder when the daemon rejects the create', async () => {
    mocks.create.mockResolvedValue({ ok: false, error: 'permission denied' });
    const dispatched = await run({ type: 'open', params: { path: '/Users/me' } });
    expect(mocks.notifyError).toHaveBeenCalledTimes(1);
    expect(mocks.notifyError.mock.calls[0][0]).toContain('/Users/me');
    expect(mocks.notifyError.mock.calls[0][1]).toEqual({ description: 'permission denied' });
    expect(mocks.navigateToRoute).not.toHaveBeenCalled();
    expect(dispatched).toEqual([]);
  });

  it('shows an error when the workspace list cannot be read', async () => {
    mocks.list.mockResolvedValue({ ok: false, error: 'daemon offline' });
    await run({ type: 'open', params: { path: '/Users/me' } });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.notifyError.mock.calls[0][1]).toEqual({ description: 'daemon offline' });
  });
});

describe('intent://open?id', () => {
  it('opens an existing workspace', async () => {
    mocks.list.mockResolvedValue({ ok: true, data: [workspace({ id: 'ws-9' })] });
    const dispatched = await run({ type: 'open', params: { id: 'ws-9' } });
    expect(dispatched).toContainEqual(openWorkspaceTab('ws-9'));
    expect(mocks.navigateToRoute).toHaveBeenCalledWith('/workspace/ws-9');
  });

  it('shows an error for an unknown workspace id', async () => {
    const dispatched = await run({ type: 'open', params: { id: 'missing' } });
    expect(mocks.notifyError).toHaveBeenCalledTimes(1);
    expect(dispatched).toEqual([]);
    expect(mocks.navigateToRoute).not.toHaveBeenCalled();
  });
});

describe('intent://create and intent://clone', () => {
  it('opens the New Space form prefilled from the link and never auto-creates', async () => {
    const dispatched = await run({
      type: 'create',
      params: {
        repo: '/Users/me/repo',
        branch: 'main',
        prompt: 'Fix the finding',
        specialist: 'implementor',
        newWindow: 'true',
        autoCreate: 'true',
      },
    });
    expect(dispatched).toEqual([setShowCreateModal(true)]);
    expect(JSON.parse(sessionStorage.getItem('workspace-prefill') ?? 'null')).toEqual({
      repoPath: '/Users/me/repo',
      branch: 'main',
      prompt: 'Fix the finding',
      specialist: 'implementor',
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('prefills a clone link as a GitHub repository', async () => {
    await run({ type: 'clone', params: { repo: 'https://github.com/o/r', branch: 'dev' } });
    expect(JSON.parse(sessionStorage.getItem('workspace-prefill') ?? 'null')).toEqual({
      githubUrl: 'https://github.com/o/r',
      branch: 'dev',
    });
  });

  it('rejects a clone link without a repository', async () => {
    const dispatched = await run({ type: 'clone', params: {} });
    expect(dispatched).toEqual([]);
    expect(mocks.notifyError).toHaveBeenCalledTimes(1);
  });
});

describe('intent://settings', () => {
  it('switches to the beta channel through the persisted preference and confirms it', async () => {
    const dispatched = await run({ type: 'settings', params: { beta: 'true' } });
    expect(dispatched).toEqual([setUpdateChannel('beta')]);
    expect(mocks.notifySuccess).toHaveBeenCalledTimes(1);
  });

  it('switches back to stable for beta=false', async () => {
    const dispatched = await run({ type: 'settings', params: { beta: 'false' } });
    expect(dispatched).toEqual([setUpdateChannel('stable')]);
  });

  it('opens Settings for a settings link without a channel', async () => {
    await run({ type: 'settings', params: { section: 'general' } });
    expect(mocks.navigateToRoute).toHaveBeenCalledWith('/settings');
  });
});

it('shows an error instead of silently dropping a link it cannot handle', async () => {
  await run({ type: 'open', params: {} });
  await run({ type: 'create', params: { title: 'only a title' } });
  expect(mocks.notifyError).toHaveBeenCalledTimes(2);
});

describe('pending queue draining', () => {
  it('consumes the window queue and handles every valid action in order', async () => {
    mocks.invoke.mockResolvedValueOnce({
      actions: [
        { type: 'open', params: { id: 'ws-1' } },
        'garbage',
        { type: 'settings', params: { beta: 'true' } },
      ],
    });
    mocks.list.mockResolvedValue({ ok: true, data: [workspace({ id: 'ws-1' })] });
    await runSaga({ dispatch: () => {}, getState: () => ({}) }, drainPendingDeepLinks).toPromise();
    expect(mocks.invoke).toHaveBeenCalledWith('deep-link:consume-pending', {});
    expect(mocks.navigateToRoute).toHaveBeenCalledWith('/workspace/ws-1');
    expect(mocks.notifySuccess).toHaveBeenCalledTimes(1);
  });

  it('drains on start, again on each nudge, and unsubscribes on cancel', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    const offById = vi.fn();
    window.electronAPI = {
      ...window.electronAPI,
      on: vi.fn((channel: string, handler: (payload: unknown) => void) => {
        handlers.set(channel, handler);
        return `listener:${channel}`;
      }),
      offById,
    };
    mocks.invoke.mockResolvedValue({ actions: [] });
    const task = runSaga({ dispatch: () => {}, getState: () => ({}) }, deepLinksSaga);
    await settle();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);

    handlers.get('deep-link')?.({ pending: true });
    await settle();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);

    task.cancel();
    await settle();
    expect(offById).toHaveBeenCalledWith('deep-link', 'listener:deep-link');
    delete (window as Partial<Window>).electronAPI;
  });
});
