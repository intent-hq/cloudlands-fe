import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';

const { selectAgentIsThinkingMock } = vi.hoisted(() => ({
  selectAgentIsThinkingMock: vi.fn((agentId: string) => ({
    subscribe: (run: (value: boolean) => void) => {
      run(agentId === 'thinking-agent');
      return () => {};
    },
  })),
}));

vi.mock('$lib/store/slices/agent-session/agent-session-selectors', () => ({
  selectAgentIsThinking: selectAgentIsThinkingMock,
}));

vi.mock('./AuggieAvatar.svelte', async () => ({
  default: (await import('../../agent-overview/__tests__/mocks/MockAuggieAvatar.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../__tests__/mocks/Fa.svelte')).default,
}));

import AugieAvatarWithState from './AugieAvatarWithState.svelte';

describe('AugieAvatarWithState avatar wiring', () => {
  beforeEach(() => {
    selectAgentIsThinkingMock.mockClear();
  });

  afterEach(() => cleanup());

  it('passes agentId to AuggieAvatar without subscribing to Thinking state', () => {
    render(AugieAvatarWithState, { props: { agentId: 'agent-1', state: 'idle' } });

    expect(selectAgentIsThinkingMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('mock-auggie-avatar').dataset.agentId).toBe('agent-1');
  });

  it('does not pass Thinking animation from coarse running/responding state', () => {
    render(AugieAvatarWithState, { props: { agentId: 'agent-1', state: 'running' } });

    expect(selectAgentIsThinkingMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('mock-auggie-avatar').dataset.hasLegacyThinkingProp).toBe('false');
    expect(screen.getByTestId('mock-auggie-avatar').dataset.hasLegacyColorSeedProp).toBe('false');
    expect(screen.getByTestId('mock-auggie-avatar').dataset.hasLegacyFaceSeedProp).toBe('false');
  });
});