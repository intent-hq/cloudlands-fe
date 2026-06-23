import {
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import { render } from '@testing-library/svelte';
import AgentsList from '../AgentsList.svelte';
import type { AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import * as BrandedIds from '$shared/types/branded-ids';

// Mock the navigation function
vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToAgent: vi.fn(),
}));

vi.mock('$store/renderer/slices/theme/theme-selectors', () => ({
  selectIsDarkTheme: Object.assign(
    () => ({
      subscribe: (run: (value: boolean) => void) => {
        run(false);
        return () => {};
      },
    }),
    { select: () => false },
  ),
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentIsThinking: Object.assign(
    () => ({
      subscribe: (run: (value: boolean) => void) => {
        run(false);
        return () => {};
      },
    }),
    { select: () => false },
  ),
  selectAgentProvider: Object.assign(
    () => ({
      subscribe: (run: (value: string | undefined) => void) => {
        run(undefined);
        return () => {};
      },
    }),
    { select: () => undefined },
  ),
}));

describe('AgentsList', () => {
  const mockAgents: AgentSession[] = [
    {
      id: BrandedIds.AgentId('agent-1'),
      backendSessionId: null,
      workspaceId: BrandedIds.WorkspaceId('workspace-1'),
      name: 'Test Agent 1',
      status: AgentStatus.Active,
      agentInfo: {
        id: BrandedIds.AgentId('agent-1'),
        name: 'Test Agent 1',
        model: 'sonnet-3.5',
      },
      messages: [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Hello from agent 1',
          timestamp: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: BrandedIds.AgentId('agent-2'),
      backendSessionId: null,
      workspaceId: BrandedIds.WorkspaceId('workspace-1'),
      name: 'Test Agent 2',
      status: AgentStatus.Active,
      agentInfo: {
        id: BrandedIds.AgentId('agent-2'),
        name: 'Test Agent 2',
        model: 'sonnet-3.5',
      },
      messages: [
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Hello from agent 2',
          timestamp: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  it('should render with array of agents', () => {
    const { container } = render(AgentsList, {
      props: {
        agents: mockAgents,
        collapsed: false,
      },
    });

    expect(container.textContent).toContain('Test Agent 1');
    expect(container.textContent).toContain('Test Agent 2');
  });

  it('should handle undefined agents prop', () => {
    const { container } = render(AgentsList, {
      props: {
        agents: undefined,
        collapsed: false,
      },
    });

    // Should not crash and should show the header
    expect(container.textContent).toContain('Threads');
  });

  it('should handle non-array agents prop gracefully', () => {
    // This simulates the case where a reactive $state value might be passed incorrectly
    const { container } = render(AgentsList, {
      props: {
        agents: null as any, // Intentionally passing wrong type
        collapsed: false,
      },
    });

    // Should not crash
    expect(container.textContent).toContain('Threads');
  });

  it('should limit visible agents when collapsed', () => {
    const manyAgents = Array.from({ length: 10 }, (_, i) => ({
      id: BrandedIds.AgentId(`agent-${i}`),
      backendSessionId: null,
      workspaceId: BrandedIds.WorkspaceId('workspace-1'),
      name: `Test Agent ${i}`,
      status: AgentStatus.Active,
      agentInfo: {
        id: BrandedIds.AgentId(`agent-${i}`),
        name: `Test Agent ${i}`,
        model: 'sonnet-3.5',
      },
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    const { container } = render(AgentsList, {
      props: {
        agents: manyAgents,
        collapsed: true,
        maxVisible: 9,
      },
    });

    // When collapsed, should only show 5 agents
    const agentElements = container.querySelectorAll("[data-testid^='agent-']");
    expect(agentElements.length).toBeLessThanOrEqual(5);
  });

  it('should filter out invalid agents', () => {
    const mixedAgents = [
      ...mockAgents,
      null as any, // Invalid agent
      { id: null } as any, // Agent with null id
      { id: '' } as any, // Agent with empty id
    ];

    const { container } = render(AgentsList, {
      props: {
        agents: mixedAgents,
        collapsed: false,
      },
    });

    // Should only render valid agents
    expect(container.textContent).toContain('Test Agent 1');
    expect(container.textContent).toContain('Test Agent 2');
  });
});
