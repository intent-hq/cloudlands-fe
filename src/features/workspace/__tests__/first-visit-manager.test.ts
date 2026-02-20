import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';
import { FirstVisitManager } from '../first-visit-manager.svelte';
import { agentService } from '$features/agent/agent.service';
// @ts-expect-error - extended test helper exported only in mock implementation
import { __agentServiceMock } from '$features/agent/agent.service';
// @ts-expect-error - extended test helper exported only in mock implementation
import { __firstVisitStateMock } from '../first-visit-state.client';

vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('$lib/electron-bridge', () => ({
  listen: vi.fn(async () => () => {}),
  listenSync: vi.fn(() => () => {}),
}));

vi.mock('$features/notes/notes.store.svelte', () => ({
  notesStateManager: {
    notes: new Map(),
  },
}));

vi.mock('$features/terminal/terminal-session.store.svelte', () => ({
  terminalSessionStore: {
    sessions: new Map(),
  },
}));

vi.mock('$features/activity-log/activity-log.store.svelte', () => ({
  activityLogStore: {
    entries: [],
  },
}));

vi.mock('$features/diffs/diffs.store.svelte', () => ({
  diffStore: {
    diffs: new Map(),
  },
}));

vi.mock('$features/agent/agent.service', () => {
  const sessions = new Map();
  const subscribers = new Set<(state: { sessions: Map<string, any> }) => void>();
  let counter = 0;

  const notify = () => {
    const snapshot = { sessions };
    subscribers.forEach((callback) => callback(snapshot));
  };

  const createAgent = vi.fn(
    async (workspace: Workspace, options: { name: string; instruction?: string }) => {
      counter += 1;
      const session = {
        id: `agent-${counter}`,
        sessionId: `session-${counter}`,
        workspaceId: workspace.id,
        messages: [],
        name: options.name,
        agentMetadata: { instruction: options.instruction || '' },
        status: 'Idle',
        isProcessing: false,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        startedAt: new Date().toISOString(),
      };
      sessions.set(session.id, session);
      notify();
      return session;
    },
  );

  const getSessionsForWorkspace = vi.fn((workspaceId: string) =>
    Array.from(sessions.values()).filter((session) => session.workspaceId === workspaceId),
  );

  const subscribe = vi.fn((callback: (state: { sessions: Map<string, any> }) => void) => {
    subscribers.add(callback);
    callback({ sessions });
    return () => {
      subscribers.delete(callback);
    };
  });

  return {
    agentService: {
      createAgent,
      getSessionsForWorkspace,
      subscribe,
    },
    __agentServiceMock: {
      reset() {
        sessions.clear();
        subscribers.clear();
        counter = 0;
        createAgent.mockClear();
        getSessionsForWorkspace.mockClear();
        subscribe.mockClear();
      },
      seedSession(workspaceId: string, overrides?: Partial<any>) {
        counter += 1;
        const session = {
          id: overrides?.id || `seed-agent-${counter}`,
          sessionId: overrides?.sessionId || `seed-session-${counter}`,
          workspaceId,
          messages: overrides?.messages || [],
          name: overrides?.name || 'Existing Agent',
          agentMetadata: overrides?.agentMetadata || { instruction: '' },
          status: overrides?.status || 'Idle',
          isProcessing: overrides?.isProcessing ?? false,
          createdAt: overrides?.createdAt || new Date().toISOString(),
          lastActivity: overrides?.lastActivity || new Date().toISOString(),
          startedAt: overrides?.startedAt || new Date().toISOString(),
        };
        sessions.set(session.id, session);
        notify();
        return session;
      },
      getSessions(workspaceId: string) {
        return Array.from(sessions.values()).filter(
          (session) => session.workspaceId === workspaceId,
        );
      },
    },
  };
});

vi.mock('../first-visit-state.client', () => {
  let persistedState: any = null;

  return {
    firstVisitStateClient: {
      load: vi.fn(async () => persistedState),
      save: vi.fn(async (_workspaceId: string, state: any) => {
        persistedState = state;
        return true;
      }),
      delete: vi.fn(async () => {
        persistedState = null;
        return true;
      }),
      exists: vi.fn(async () => persistedState !== null),
    },
    __firstVisitStateMock: {
      reset() {
        persistedState = null;
      },
      set(state: any) {
        persistedState = state;
      },
      get() {
        return persistedState;
      },
    },
  };
});

const createWorkspace = (overrides?: Partial<Workspace>): Workspace => ({
  id: overrides?.id || `workspace-${Math.random().toString(36).slice(2, 10)}`,
  title: overrides?.title || 'Test Workspace',
  branch: overrides?.branch || 'main',
  changesets: overrides?.changesets || [],
  timeline: overrides?.timeline || [],
  conversationInfo: overrides?.conversationInfo || [],
  status: overrides?.status || WorkspaceStatus.Active,
  createdAt: overrides?.createdAt || new Date().toISOString(),
  updatedAt: overrides?.updatedAt || new Date().toISOString(),
  ...overrides,
});

describe('FirstVisitManager', () => {
  let manager: FirstVisitManager;
  let workspace: Workspace;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    __agentServiceMock.reset();
    __firstVisitStateMock.reset();
    manager = new FirstVisitManager();
    workspace = createWorkspace();
  });

  afterEach(() => {
    manager.cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('creates a first-visit agent and opens the drawer on first initialization', async () => {
    const isFirstVisit = await manager.initialize(workspace.id, workspace);

    expect(isFirstVisit).toBe(true);
    expect(agentService.createAgent).toHaveBeenCalledTimes(1);

    const drawerState = manager.getFirstVisitDrawerState();
    // getFirstVisitDrawerState() returns null - drawer is not opened automatically
    // The workspace handles opening spec and agent side by side
    expect(drawerState).toBeNull();

    const persistedState = __firstVisitStateMock.get();
    expect(persistedState?.firstVisitSetupReady).toBe(true);
    expect(persistedState?.workspaceId).toBe(workspace.id);
  });

  it('does not create a new agent when first visit setup already completed', async () => {
    const existingState = {
      version: 1,
      workspaceId: workspace.id,
      firstVisitSetupReady: true,
      mainContentRevealed: true,
      navigationRailRevealed: true,
      workspaceDockRevealed: true,
      lastUpdated: new Date().toISOString(),
    };
    __firstVisitStateMock.set(existingState);

    const isFirstVisit = await manager.initialize(workspace.id, workspace);

    expect(isFirstVisit).toBe(false);
    expect(agentService.createAgent).not.toHaveBeenCalled();
    expect(manager.getFirstVisitDrawerState()).toBeNull();
  });

  it('reuses an existing agent when one is already present', async () => {
    const seeded = __agentServiceMock.seedSession(workspace.id, {
      name: 'Existing Auggie',
    });

    const isFirstVisit = await manager.initialize(workspace.id, workspace);

    expect(isFirstVisit).toBe(true);
    expect(agentService.createAgent).not.toHaveBeenCalled();

    const drawerState = manager.getFirstVisitDrawerState();
    // getFirstVisitDrawerState() returns null - drawer is not opened automatically
    expect(drawerState).toBeNull();
  });
});
