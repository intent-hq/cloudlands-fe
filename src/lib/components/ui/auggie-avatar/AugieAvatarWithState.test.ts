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

type ReadableArg<T> = T | { subscribe: (run: (value: T) => void) => () => void };

const { selectAgentIsThinkingMock, selectAgentProviderMock } = vi.hoisted(() => ({
  selectAgentIsThinkingMock: vi.fn((agentId: string) => ({
    subscribe: (run: (value: boolean) => void) => {
      run(agentId === 'thinking-agent');
      return () => {};
    },
  })),
  selectAgentProviderMock: vi.fn((agentId: ReadableArg<string>) => ({
    subscribe: (run: (value: string | undefined) => void) => {
      const providerForAgent = (id: string) =>
        id.includes('codex') ? 'codex' : id.includes('auggie') ? 'auggie' : undefined;
      if (typeof agentId === 'string') {
        run(providerForAgent(agentId));
        return () => {};
      }
      return agentId.subscribe((id) => run(providerForAgent(id)));
    },
  })),
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentIsThinking: selectAgentIsThinkingMock,
  selectAgentProvider: selectAgentProviderMock,
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
    selectAgentProviderMock.mockClear();
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

  it('hides the completed checkmark for known non-auggie provider avatars while keeping dimming', () => {
    render(AugieAvatarWithState, { props: { agentId: 'codex-agent', state: 'completed' } });

    const avatar = screen.getByTestId('mock-auggie-avatar');
    expect(selectAgentProviderMock).toHaveBeenCalledOnce();
    expect(avatar.parentElement?.classList.contains('opacity-30')).toBe(true);
    expect(document.querySelector('[data-icon="check"]')).toBeNull();
  });

  it('keeps the completed checkmark for auggie avatars', () => {
    render(AugieAvatarWithState, { props: { agentId: 'auggie-agent', state: 'completed' } });

    const avatar = screen.getByTestId('mock-auggie-avatar');
    expect(avatar.parentElement?.classList.contains('opacity-30')).toBe(true);
    expect(document.querySelector('[data-icon="check"]')).not.toBeNull();
  });
});
