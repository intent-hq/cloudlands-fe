import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  cleanup,
  render,
  screen,
} from '@testing-library/svelte';
import type { AgentNode } from '../types';

const {
  thinkingByAgentId,
  waitingByAgentId,
  waitingForOtherAgentsByAgentId,
  respondingByAgentId,
  selectAgentIsThinkingMock,
  selectAgentIsWaitingMock,
  selectAgentIsWaitingForOtherAgentsMock,
  selectAgentIsRespondingMock,
} = vi.hoisted(() => {
  const thinkingByAgentId = new Map<string, boolean>();
  const waitingByAgentId = new Map<string, boolean>();
  const waitingForOtherAgentsByAgentId = new Map<string, boolean>();
  const respondingByAgentId = new Map<string, boolean>();
  return {
    thinkingByAgentId,
    waitingByAgentId,
    waitingForOtherAgentsByAgentId,
    respondingByAgentId,
    selectAgentIsThinkingMock: vi.fn((agentId: string) => ({
      subscribe: (run: (value: boolean) => void) => {
        run(thinkingByAgentId.get(agentId) ?? false);
        return () => {};
      },
    })),
    selectAgentIsWaitingMock: vi.fn((agentId: string) => ({
      subscribe: (run: (value: boolean) => void) => {
        run(waitingByAgentId.get(agentId) ?? false);
        return () => {};
      },
    })),
    selectAgentIsWaitingForOtherAgentsMock: vi.fn((agentId: string) => ({
      subscribe: (run: (value: boolean) => void) => {
        run(waitingForOtherAgentsByAgentId.get(agentId) ?? false);
        return () => {};
      },
    })),
    selectAgentIsRespondingMock: vi.fn((agentId: string) => ({
      subscribe: (run: (value: boolean) => void) => {
        run(respondingByAgentId.get(agentId) ?? false);
        return () => {};
      },
    })),
  };
});

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentIsResponding: selectAgentIsRespondingMock,
  selectAgentIsThinking: selectAgentIsThinkingMock,
  selectAgentIsWaiting: selectAgentIsWaitingMock,
  selectAgentIsWaitingForOtherAgents: selectAgentIsWaitingForOtherAgentsMock,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../../ui/__tests__/mocks/Fa.svelte')).default,
}));

vi.mock('$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

import AgentHierarchyCard from '../AgentHierarchyCard.svelte';

function makeAgent(overrides: Partial<AgentNode> = {}): AgentNode {
  return {
    id: 'agent-a1',
    type: 'agent',
    agentId: 'a1',
    name: 'Agent One',
    isCoordinator: true,
    status: 'responding',
    specialist: null,
    parentAgentId: null,
    createdAt: '2026-03-20T13:00:00.000Z',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    ...overrides,
  };
}

describe('AgentHierarchyCard Thinking consumer wiring', () => {
  beforeEach(() => {
    thinkingByAgentId.clear();
    waitingByAgentId.clear();
    waitingForOtherAgentsByAgentId.clear();
    respondingByAgentId.clear();
    selectAgentIsThinkingMock.mockClear();
    selectAgentIsWaitingMock.mockClear();
    selectAgentIsWaitingForOtherAgentsMock.mockClear();
    selectAgentIsRespondingMock.mockClear();
  });

  afterEach(() => cleanup());

  it('renders Thinking from selectAgentIsThinking(agentId)', () => {
    thinkingByAgentId.set('a1', true);

    render(AgentHierarchyCard, { props: { agent: makeAgent() } });

    expect(selectAgentIsThinkingMock).toHaveBeenCalledWith('a1');
    expect(selectAgentIsWaitingMock).toHaveBeenCalledWith('a1');
    expect(selectAgentIsWaitingForOtherAgentsMock).toHaveBeenCalledWith('a1');
    expect(selectAgentIsRespondingMock).toHaveBeenCalledWith('a1');
    expect(screen.getByText('Thinking...')).toBeTruthy();
  });

  it('uses selector-derived Thinking as the label source even when an active tool is present', () => {
    thinkingByAgentId.set('a1', true);

    const { container } = render(AgentHierarchyCard, {
      props: { agent: makeAgent({ activeToolName: 'read_file', activeToolInput: {} }) },
    });

    expect(screen.getByText('Thinking...')).toBeTruthy();
    expect(container.textContent).not.toContain('Read');
  });

  it('renders selector-derived Thinking for active waiting states without waiting-for agents', () => {
    thinkingByAgentId.set('a1', true);

    render(AgentHierarchyCard, { props: { agent: makeAgent({ status: 'waiting' }) } });

    expect(screen.getByText('Thinking...')).toBeTruthy();
    expect(screen.queryByText(/^Waiting for/)).toBeNull();
  });

  it('renders selector-derived Thinking for waiting tool-result states', () => {
    thinkingByAgentId.set('a1', true);

    const { container } = render(AgentHierarchyCard, {
      props: { agent: makeAgent({ status: 'waiting', activeToolName: 'read_file' }) },
    });

    expect(screen.getByText('Thinking...')).toBeTruthy();
    expect(container.textContent).not.toContain('Read');
    expect(screen.queryByText(/^Waiting for/)).toBeNull();
  });

  it('keeps explicit waiting-for-other-agents distinct from active thread Thinking', () => {
    thinkingByAgentId.set('a1', true);
    waitingByAgentId.set('a1', true);
    waitingForOtherAgentsByAgentId.set('a1', true);

    render(AgentHierarchyCard, {
      props: {
        agent: makeAgent({
          status: 'waiting',
          waitingForAgentIds: ['a2'],
        }),
        agentNames: new Map([['a2', 'Agent Two']]),
      },
    });

    expect(screen.getByText('Waiting for Agent Two')).toBeTruthy();
    expect(screen.queryByText('Thinking...')).toBeNull();
  });

  it('does not derive waiting-for-other-agents display from ids when selector is false', () => {
    thinkingByAgentId.set('a1', true);
    waitingByAgentId.set('a1', true);
    waitingForOtherAgentsByAgentId.set('a1', false);

    render(AgentHierarchyCard, {
      props: {
        agent: makeAgent({ status: 'responding', waitingForAgentIds: ['a2'] }),
        agentNames: new Map([['a2', 'Agent Two']]),
      },
    });

    expect(screen.queryByText('Waiting for Agent Two')).toBeNull();
    expect(screen.getByText('Thinking...')).toBeTruthy();
  });
});
