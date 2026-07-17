/**
 * Tests for WorkspaceCard idle activity behavior.
 *
 * Verifies that when workspace.activity === 'idle', the card suppresses
 * running-state agent avatars regardless of stale tracker/Redux data,
 * while preserving unread-agent icons.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import type { Workspace, AgentSession, WorkspaceId, AgentId } from '$shared/types';
import { WorkspaceStatus, AgentStatus } from '$shared/types';
import { createTestWorkspaceId, createTestAgentId } from '../../../../test/factories/workspace.factory';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const streamingAgentIds: string[] = [];
  const state = {
    agentSessions: {
      byAgentId: {} as Record<string, AgentSession>,
    },
  };

  const readable = <T>(value: T) => ({
    subscribe(run: (v: T) => void) {
      run(value);
      return () => {};
    },
  });

  const selector = <T>(getter: (state: any, ...args: any[]) => T) =>
    Object.assign(
      (...args: any[]) => readable(getter(state, ...args)),
      { select: (s: any, ...a: any[]) => getter(s ?? state, ...a) }
    );

  return { dispatch, streamingAgentIds, state, readable, selector };
});

vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/') } }));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => mocks.state,
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: mocks.selector((state, agentId: string) => state.agentSessions.byAgentId[agentId] ?? null),
  selectAgentIsResponding: mocks.selector((state, agentId: string) => {
    const session = state.agentSessions.byAgentId[agentId];
    return session?.isStreaming || session?.isProcessing || false;
  }),
  selectAgentIsWaiting: mocks.selector(() => false),
  selectAgentProvider: mocks.selector(() => 'auggie'),
}));

vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-selectors', () => ({
  selectWorkspaceTaskProgress: mocks.selector(() => ({ total: 0, completed: 0 })),
}));

vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-slice', () => ({
  ensureWorkspaceTasksLoaded: vi.fn((id) => ({ type: 'workspace-tasks/ensureLoaded', payload: id })),
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceActivePullRequest: mocks.selector(() => null),
}));

vi.mock('$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte', async () => ({
  default: (await import('./mocks/MockAugieAvatar.svelte')).default,
}));

import WorkspaceCard from '../WorkspaceCard.svelte';

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: createTestWorkspaceId(),
    title: 'Test Workspace',
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activity: 'idle',
    agentSummary: { agentIds: [], hasActiveAgents: false },
    ...overrides,
  } as Workspace;
}

function makeSession(agentId: AgentId, workspaceId: WorkspaceId, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: agentId,
    backendSessionId: null,
    workspaceId,
    name: 'Test Agent',
    status: AgentStatus.Idle,
    messages: [],
    model: 'test-model',
    createdAt: new Date(),
    updatedAt: new Date(),
    isStreaming: false,
    isProcessing: false,
    ...overrides,
  } as AgentSession;
}

describe('WorkspaceCard idle activity behavior', () => {
  beforeEach(() => {
    mocks.state.agentSessions.byAgentId = {};
    mocks.streamingAgentIds.length = 0;
  });

  it('suppresses running avatars when workspace.activity === "idle" despite stale tracker data', () => {
    const wsId = createTestWorkspaceId();
    const agentId = createTestAgentId();
    const workspace = makeWorkspace({ id: wsId, activity: 'idle', agentSummary: { agentIds: [agentId], hasActiveAgents: false } });

    // Stale tracker claims agent is streaming
    mocks.streamingAgentIds.push(agentId);

    const { container } = render(WorkspaceCard, {
      props: { workspace, streamingAgentIds: mocks.streamingAgentIds, isRunning: true },
    });

    // No running-state avatars should render (the mocked avatar with data-state="running")
    const runningAvatars = container.querySelectorAll('[data-state="running"]');
    expect(runningAvatars).toHaveLength(0);
  });

  it('suppresses running avatars when workspace.activity === "idle" despite Redux isStreaming=true', () => {
    const wsId = createTestWorkspaceId();
    const agentId = createTestAgentId();
    const workspace = makeWorkspace({ id: wsId, activity: 'idle', agentSummary: { agentIds: [agentId], hasActiveAgents: false } });

    // Stale Redux session claims streaming
    mocks.state.agentSessions.byAgentId[agentId] = makeSession(agentId, wsId, { isStreaming: true });

    const { container } = render(WorkspaceCard, {
      props: { workspace, streamingAgentIds: [], isRunning: false },
    });

    const runningAvatars = container.querySelectorAll('[data-state="running"]');
    expect(runningAvatars).toHaveLength(0);
  });

  it('renders running avatars when workspace.activity === "agent_running"', () => {
    const wsId = createTestWorkspaceId();
    const agentId = createTestAgentId();
    const workspace = makeWorkspace({ id: wsId, activity: 'agent_running', agentSummary: { agentIds: [agentId], hasActiveAgents: true } });

    mocks.streamingAgentIds.push(agentId);

    const { container } = render(WorkspaceCard, {
      props: { workspace, streamingAgentIds: mocks.streamingAgentIds, isRunning: true },
    });

    // Running avatars should render when workspace is not idle
    const runningAvatars = container.querySelectorAll('[data-state="running"]');
    expect(runningAvatars.length).toBeGreaterThan(0);
  });

  it('preserves unread-agent icons when workspace.activity === "idle"', () => {
    const wsId = createTestWorkspaceId();
    const agentId = createTestAgentId();
    const workspace = makeWorkspace({ id: wsId, activity: 'idle', agentSummary: { agentIds: [agentId], hasActiveAgents: false } });

    // Agent is idle (not streaming/processing in Redux)
    mocks.state.agentSessions.byAgentId[agentId] = makeSession(agentId, wsId, { isStreaming: false });

    const { container } = render(WorkspaceCard, {
      props: { workspace, streamingAgentIds: [], isRunning: false, unreadAgentIds: [agentId] },
    });

    // Unread agent avatars should still render (even though workspace is idle)
    const avatars = container.querySelectorAll('[data-agent-id]');
    expect(avatars.length).toBeGreaterThan(0);
  });
});
