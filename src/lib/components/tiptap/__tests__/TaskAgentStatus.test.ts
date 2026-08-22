/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentStatus, type AgentSession } from '$shared/types';
import TaskAgentStatus from '../TaskAgentStatus.svelte';

const sessionState = vi.hoisted(() => {
  let session: AgentSession | undefined;
  const subscribers = new Set<(value: AgentSession | undefined) => void>();
  return {
    get: () => session,
    set(value: AgentSession | undefined) {
      session = value;
      subscribers.forEach((subscriber) => subscriber(value));
    },
    readable: {
      subscribe(subscriber: (value: AgentSession | undefined) => void) {
        subscribers.add(subscriber);
        subscriber(session);
        return () => subscribers.delete(subscriber);
      },
    },
  };
});
const dispatchMock = vi.hoisted(() => vi.fn());
const pollingManagerMock = vi.hoisted(() => ({ register: vi.fn(), unregister: vi.fn() }));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: Object.assign(() => sessionState.readable, {
    select: () => sessionState.get(),
  }),
  selectAgentIsResponding: Object.assign(
    () => ({
      subscribe(subscriber: (value: boolean) => void) {
        subscriber(Boolean(sessionState.get()?.isResponding));
        return () => {};
      },
    }),
    { select: () => Boolean(sessionState.get()?.isResponding) },
  ),
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: { select: () => ({ id: 'workspace-1' }) },
}));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-slice', () => ({
  restoreAgentSessionRequested: () => ({ promise: Promise.resolve(undefined) }),
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: dispatchMock });
});
vi.mock('$lib/utils/workspace-route-context', () => ({
  getWorkspaceRouteContext: () => ({ workspaceId: 'workspace-1' }),
}));
vi.mock('../task-agent-polling-manager', () => ({
  taskAgentPollingManager: pollingManagerMock,
}));

function agent(status: AgentStatus, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'agent-1',
    backendSessionId: null,
    workspaceId: 'workspace-1',
    name: 'Linked task agent',
    status,
    messages: [],
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  } as AgentSession;
}

describe('TaskAgentStatus indicator', () => {
  beforeEach(() => {
    sessionState.set(undefined);
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it.each([
    ['loading', undefined, /Open agent agent-1: Spinning up/i, 'unknown', 'idle'],
    [
      'active',
      agent(AgentStatus.Active, { isResponding: true, isStreaming: true }),
      /Open agent Linked task agent: Working/i,
      'streaming',
      'running',
    ],
    [
      'complete',
      agent(AgentStatus.Completed),
      /Open agent Linked task agent: Completed/i,
      'complete',
      'completed',
    ],
    [
      'error',
      agent(AgentStatus.Error),
      /Open agent Linked task agent: Error occurred/i,
      'error',
      'failed',
    ],
  ])('renders one accessible %s control', async (_, value, name, status, avatarState) => {
    sessionState.set(value);
    const { container, getByRole } = render(TaskAgentStatus, {
      props: { agentId: 'agent-1', compact: true, indicator: true },
    });

    const control = await waitFor(() => getByRole('button', { name }));
    expect(control.dataset.agentDisplayStatus).toBe(status);
    expect(
      control.querySelector('[data-agent-avatar-with-state]')?.getAttribute('data-avatar-state'),
    ).toBe(avatarState);
    expect(control.querySelector('.status-content')).toBeNull();
    expect(container.querySelector('button button')).toBeNull();
  });

  it('never exposes response content and keeps agent navigation', async () => {
    sessionState.set(
      agent(AgentStatus.Active, {
        digest: '**raw digest**',
        lastAgentResponse: '[raw Markdown](https://example.com)',
      }),
    );
    const { container, getByRole } = render(TaskAgentStatus, {
      props: { agentId: 'agent-1', indicator: true },
    });

    const control = getByRole('button', { name: /Open agent Linked task agent/i });
    expect(container.textContent).not.toContain('raw digest');
    expect(container.textContent).not.toContain('raw Markdown');
    await fireEvent.click(control);
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'appLayout/openAgentTabRequested' }),
    );
  });
});
