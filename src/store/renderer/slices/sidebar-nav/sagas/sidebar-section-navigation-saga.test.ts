import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendRequest } from '$lib/client/live/backend-transport';
import { initialState as scripts } from '../../scripts/scripts-slice';
import { initialState as guestSessions } from '../../guest-sessions/guest-sessions-slice';
import type { AgentSession } from '$shared/types';
import type { PanelTab } from '../../panel-layout/panel-layout-types';
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { workspaceReducer, setWorkspaceEntity } from '../../workspace/workspace-slice';
import { agentSessionReducer, bulkUpsertSessions } from '../../agent-session/agent-session-slice';
import { workspaceAgentsReducer, setAgents } from '../../workspace-agents/workspace-agents-slice';
import { openAgentTabRequested } from '../../app-layout/app-layout-slice';
import { initializeLayout, panelLayoutReducer } from '../../panel-layout/panel-layout-slice';
import {
  selectActiveTab,
  selectAllTabs,
  selectFocusedPanelId,
} from '../../panel-layout/panel-layout-selectors';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { markNoteRead } from '../../note-read-tracking/note-read-tracking-slice';
import { openFirstPanelTerminalRequested } from '../../terminals/terminals-slice';
import {
  activateSidebarSectionRequested,
  cancelSidebarSectionNavigation,
} from '../sidebar-nav-slice';
import { sidebarSectionNavigationSaga } from './sidebar-section-navigation-saga';
import { appLayoutNavigationSaga } from '../../app-layout/sagas/app-layout-navigation-saga';
import { fork } from 'typed-redux-saga';
import { assistantPanelLayoutId } from '$shared/assistant-panel-layout';
import { principalContextChanged, principalReducer } from '../../principal/principal-slice';

vi.mock('$lib/client/live/backend-transport', async (original) => ({
  ...(await original<typeof import('$lib/client/live/backend-transport')>()),
  backendRequest: vi.fn(),
}));
vi.mock('$lib/client', async () => {
  const { LiveFilesClient } = await import('$lib/client/live/live-files-client');
  return { appClient: { files: new LiveFilesClient() } };
});

const workspaceId = 'workspace';
// Non-default layouts in production are assistant layouts, which host tabs from any workspace.
const layoutId = assistantPanelLayoutId('coordinator');
const workspacePath = '/repo/workspace/';
const conversation: PanelTab = {
  id: 'conversation',
  type: 'agent',
  title: 'Main',
  agentId: 'main',
  closable: true,
};
const tasks: Task[] = [];

function agent(id: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return { id, workspaceId, status: 'idle', name: id, messages: [], ...overrides } as AgentSession;
}

function start({
  agents = [agent('main', { metadata: { specialist: 'spec-writer' } })],
  tabs = [],
  hidden = [],
  collaborator = false,
  conversationFocused = false,
}: {
  agents?: AgentSession[];
  tabs?: PanelTab[];
  hidden?: PanelTab[];
  collaborator?: boolean;
  conversationFocused?: boolean;
} = {}) {
  let state = withLegacyPrincipal(
    {
      scripts,
      guestSessions: { ...guestSessions, hasReceivedList: true },
      workspace: workspaceReducer(
        undefined,
        setWorkspaceEntity({
          id: workspaceId,
          myRole: collaborator ? 'collaborator' : 'owner',
          worktreePath: workspacePath,
        } as never),
      ),
      workspaceAgents: workspaceAgentsReducer(undefined, setAgents(workspaceId, agents)),
      agentSessions: agentSessionReducer(undefined, bulkUpsertSessions(agents)),
      panelLayout: panelLayoutReducer(
        undefined,
        initializeLayout(layoutId, {
          root: conversationFocused
            ? {
                type: 'split',
                direction: 'horizontal',
                sizes: [50, 50],
                children: [
                  { type: 'panel', panelId: 'chat-panel' },
                  { type: 'panel', panelId: 'main-panel' },
                ],
              }
            : { type: 'panel', panelId: 'main-panel' },
          panels: {
            'main-panel': { id: 'main-panel', tabs, activeTabId: tabs[0]?.id ?? null },
            ...(conversationFocused
              ? {
                  'chat-panel': {
                    id: 'chat-panel',
                    tabs: [conversation],
                    activeTabId: conversation.id,
                  },
                }
              : {}),
          },
          focusedPanelId: conversationFocused ? 'chat-panel' : 'main-panel',
          hiddenTabs: hidden,
        }),
      ),
      workspaceNotes: { byWorkspaceId: {} },
    },
    collaborator ? 'guest' : 'owner',
  );
  const channel = stdChannel();
  const dispatched: Array<{ type: string; payload?: unknown }> = [];
  const dispatch = (action: { type: string; payload?: unknown }) => {
    dispatched.push(action);
    state = {
      ...state,
      panelLayout: panelLayoutReducer(state.panelLayout, action),
      principal: principalReducer(state.principal, action),
    };
    channel.put(action);
  };
  tasks.push(
    runSaga({ channel, dispatch, getState: () => state }, function* () {
      yield* fork(sidebarSectionNavigationSaga);
      yield* fork(appLayoutNavigationSaga);
    }),
  );
  return {
    dispatch,
    dispatched,
    activate: (section: string) =>
      dispatch(activateSidebarSectionRequested(workspaceId, section, layoutId)),
    active: () => selectActiveTab.select(state, layoutId),
    focusedPanelId: () => selectFocusedPanelId.select(state, layoutId),
    tabs: () => selectAllTabs.select(state, layoutId),
  };
}

afterEach(async () => {
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
  vi.resetAllMocks();
});

describe('sidebar section destinations', () => {
  it('opens the canonical main agent, ignoring delegated, retired and background sessions', () => {
    const run = start({
      agents: [
        agent('ordinary'),
        agent('delegated', { parentSessionId: 'parent' }),
        agent('retired', { retiredAt: '2026-10-20T12:00:00Z' }),
        agent('background', { isBackground: true }),
        agent('coordinator', { metadata: { specialist: 'spec-writer' } }),
      ],
    });
    run.activate('agents');
    expect(run.dispatched).toContainEqual(
      openAgentTabRequested(workspaceId, {
        agentId: 'coordinator',
        panelLayoutId: layoutId,
        sourcePanelId: 'main-panel',
      }),
    );
  });

  it('opens Spec and the changes list, reusing the existing destination on repeated activation', () => {
    const run = start();
    run.activate('context');
    expect(run.active()).toMatchObject({ type: 'note', noteId: 'spec', workspaceId });
    expect(run.dispatched).toContainEqual({
      type: markNoteRead.type,
      payload: expect.objectContaining({ workspaceId, noteId: 'spec' }),
    });
    run.activate('changes');
    expect(run.active()).toMatchObject({ type: 'local-changes', workspaceId });
    run.activate('context');
    expect(run.active()).toMatchObject({ type: 'note', noteId: 'spec' });
    expect(run.tabs()).toHaveLength(2);
  });

  it.each([
    {
      entries: [
        { name: 'src', type: 'directory' },
        { name: 'package.json', type: 'file' },
        { name: 'rEaDmE.md', type: 'file' },
      ],
      path: 'rEaDmE.md',
    },
    {
      entries: [
        { name: 'src', type: 'directory' },
        { name: 'package.json', type: 'file' },
      ],
      path: 'package.json',
    },
  ])('opens $path from the root file.list response', async ({ entries, path }) => {
    vi.mocked(backendRequest).mockResolvedValue(entries);
    const run = start();
    run.activate('files');
    await vi.waitFor(() =>
      expect(run.active()).toMatchObject({ type: 'file', filePath: `/repo/workspace/${path}` }),
    );
    expect(backendRequest).toHaveBeenCalledExactlyOnceWith('file.list', { workspaceId, path: '.' });
  });

  it('descends only when the root has no file and skips empty folders', async () => {
    vi.mocked(backendRequest)
      .mockResolvedValueOnce([
        { name: 'empty', type: 'directory' },
        { name: 'src', type: 'directory' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ name: 'index.ts', type: 'file' }]);
    const run = start();
    run.activate('files');
    await vi.waitFor(() =>
      expect(run.active()).toMatchObject({
        type: 'file',
        filePath: '/repo/workspace/src/index.ts',
        title: 'index.ts',
      }),
    );
    expect(vi.mocked(backendRequest).mock.calls).toEqual([
      ['file.list', { workspaceId, path: '.' }],
      ['file.list', { workspaceId, path: 'empty' }],
      ['file.list', { workspaceId, path: 'src' }],
    ]);
  });

  it.each(['context', 'cancellation', 'unmount'])(
    'does not open a late file after %s',
    async (next) => {
      let resolve!: (entries: unknown) => void;
      vi.mocked(backendRequest).mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      const run = start();
      run.activate('files');
      if (next === 'unmount') run.dispatch(workspaceUnmounted(workspaceId));
      else if (next === 'cancellation') run.dispatch(cancelSidebarSectionNavigation(workspaceId));
      else run.activate(next);
      resolve([{ name: 'README.md', type: 'file' }]);
      await new Promise((done) => setTimeout(done, 0));
      expect(run.tabs().some((tab) => tab.type === 'file')).toBe(false);
    },
  );

  it('stops descending through files when the admitted connection changes', async () => {
    let resolve!: (entries: unknown) => void;
    vi.mocked(backendRequest).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const run = start();
    run.activate('files');
    run.dispatch(principalContextChanged(null));
    resolve([{ name: 'src', type: 'directory' }]);
    await new Promise((done) => setTimeout(done, 0));
    expect(backendRequest).toHaveBeenCalledExactlyOnceWith('file.list', { workspaceId, path: '.' });
    expect(run.tabs()).toHaveLength(0);
  });

  it('keeps empty or unreadable file trees usable and allows retry', async () => {
    vi.mocked(backendRequest)
      .mockRejectedValueOnce(new Error('unreadable'))
      .mockResolvedValueOnce([{ name: 'README', type: 'file' }]);
    const run = start();
    run.activate('files');
    await new Promise((done) => setTimeout(done, 0));
    expect(run.tabs()).toHaveLength(0);
    run.activate('files');
    await vi.waitFor(() =>
      expect(run.active()).toMatchObject({ filePath: '/repo/workspace/README' }),
    );
  });

  it('focuses the first grouped browser rather than an earlier unclaimed tab', () => {
    const run = start({
      conversationFocused: true,
      tabs: [
        { id: 'unclaimed', type: 'browser', title: 'Unclaimed', browserUrl: 'https://example.org' },
        {
          id: 'owned',
          type: 'browser',
          title: 'Owned',
          browserUrl: 'https://example.com',
          ownerAgentId: 'main',
        },
      ],
    });
    run.activate('browser');
    expect(run.focusedPanelId()).toBe('main-panel');
    expect(run.active()?.id).toBe('owned');
    expect(run.tabs()).toHaveLength(3);
  });

  it('restores and focuses the first hidden browser instead of leaving the conversation focused', () => {
    const run = start({
      conversationFocused: true,
      hidden: [
        {
          id: 'hidden',
          type: 'browser',
          title: 'Hidden',
          browserUrl: 'https://example.com',
          ownerAgentId: 'main',
        },
      ],
    });
    run.activate('browser');
    expect(run.tabs().map((tab) => tab.id)).toContain('hidden');
    expect(run.active()?.id).toBe('hidden');
  });

  it('delegates Shells to the terminal owner with the focused panel', () => {
    const run = start();
    run.activate('shell');
    expect(run.dispatched).toContainEqual(
      openFirstPanelTerminalRequested(workspaceId, 'main-panel'),
    );
  });

  it('does not open owner-only browser or terminal content for collaborators', () => {
    const run = start({ collaborator: true });
    run.activate('browser');
    run.activate('shell');
    expect(run.tabs()).toHaveLength(0);
    expect(
      run.dispatched.some((action) => action.type === openFirstPanelTerminalRequested.type),
    ).toBe(false);
  });

  it('keeps agent, Spec and file navigation for collaborators', async () => {
    vi.mocked(backendRequest).mockResolvedValue([{ name: 'README.md', type: 'file' }]);
    const run = start({
      collaborator: true,
      agents: [agent('coordinator', { metadata: { specialist: 'spec-writer' } })],
    });
    run.activate('agents');
    expect(run.dispatched).toContainEqual(
      openAgentTabRequested(workspaceId, {
        agentId: 'coordinator',
        panelLayoutId: layoutId,
        sourcePanelId: 'main-panel',
      }),
    );
    run.activate('context');
    expect(run.active()).toMatchObject({ type: 'note', noteId: 'spec' });
    run.activate('files');
    await vi.waitFor(() =>
      expect(run.active()).toMatchObject({ filePath: '/repo/workspace/README.md' }),
    );
  });
});
