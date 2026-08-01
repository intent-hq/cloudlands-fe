import {
  afterEach,
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

const makeReadable = <T>(value: T) => ({
  subscribe: (run: (value: T) => void) => {
    run(value);
    return () => {};
  },
});

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: () => makeReadable(null),
  selectAgentIsResponding: () => makeReadable(false),
  selectAgentIsWaiting: () => makeReadable(false),
  selectAgentSessionStreamingContent: () => makeReadable(''),
  selectAgentSessionHasStreamOwnedMessage: () => makeReadable(false),
  selectAgentProvider: () => makeReadable(undefined),
}));

vi.mock('$store/renderer/slices/permission/permission-selectors', () => ({
  selectPendingCount: () => makeReadable(0),
}));

vi.mock('$store/renderer/slices/changes/changes-selectors', () => ({
  selectAgentLineStats: () => makeReadable(null),
}));

vi.mock('../../ui/auggie-avatar/AugieAvatarWithState.svelte', async () => ({
  default: (await import('./mocks/MockAvatarWithState.svelte')).default,
}));

vi.mock('$lib/components/ui/tooltip', async () => {
  const SlotOnly = (await import('./mocks/SlotOnly.svelte')).default;
  return {
    Provider: SlotOnly,
    Root: SlotOnly,
    Trigger: SlotOnly,
    Content: SlotOnly,
  };
});

import AgentCard from '../AgentCard.svelte';
import InlineAgentAvatar from '../InlineAgentAvatar.svelte';

describe('isCompleted avatar state wiring', () => {
  afterEach(() => cleanup());

  it('InlineAgentAvatar renders completed avatar state when isCompleted is true', () => {
    render(InlineAgentAvatar, { props: { agentId: 'agent-1', isCompleted: true } });

    expect(screen.getByTestId('mock-avatar-with-state').dataset.state).toBe('completed');
  });

  it('InlineAgentAvatar defaults to non-completed avatar state', () => {
    render(InlineAgentAvatar, { props: { agentId: 'agent-1' } });

    expect(screen.getByTestId('mock-avatar-with-state').dataset.state).toBe('idle');
  });

  it('AgentCard renders completed avatar state when isCompleted is true', () => {
    render(AgentCard, { props: { agentId: 'agent-1', isCompleted: true } });

    expect(screen.getByTestId('mock-avatar-with-state').dataset.state).toBe('completed');
  });

  it('AgentCard defaults to non-completed avatar state', () => {
    render(AgentCard, { props: { agentId: 'agent-1' } });

    expect(screen.getByTestId('mock-avatar-with-state').dataset.state).toBe('idle');
  });
});
