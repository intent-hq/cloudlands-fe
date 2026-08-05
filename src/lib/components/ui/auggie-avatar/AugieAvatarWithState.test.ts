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
import { tick } from 'svelte';

const {
  selectAgentIsThinkingMock,
  selectAgentProviderMock,
} = vi.hoisted(() => {
  type ReadableLike<T> = { subscribe(run: (value: T) => void): () => void };
  const providerForAgent = (id: string | undefined) =>
    id?.includes('codex') ? 'codex' : id?.includes('auggie') ? 'auggie' : undefined;
  const selectAgentProviderMock = vi.fn((agentId?: string | ReadableLike<string | undefined>) => ({
    subscribe: (run: (value: string | undefined) => void) => {
      if (agentId && typeof agentId !== 'string') {
        return agentId.subscribe((id) => run(providerForAgent(id)));
      }
      run(providerForAgent(agentId));
      return () => {};
    },
  }));

  return {
    selectAgentIsThinkingMock: vi.fn((agentId: string) => ({
      subscribe: (run: (value: boolean) => void) => {
        run(agentId === 'thinking-agent');
        return () => {};
      },
    })),
    selectAgentProviderMock,
  };
});

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentIsThinking: selectAgentIsThinkingMock,
  selectAgentProvider: selectAgentProviderMock,
}));

vi.mock('$store/renderer/store', () => ({
  store: { state: {} },
}));

vi.mock('./AuggieAvatar.svelte', async () => ({
  default: (await import('../../agent-overview/__tests__/mocks/MockAuggieAvatar.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../__tests__/mocks/Fa.svelte')).default,
}));

import AugieAvatarWithState from './AugieAvatarWithState.svelte';
import { warmImport } from '../../../../test/warm-import';

function expectReadableAgentArg(mock: ReturnType<typeof vi.fn>, expectedAgentId: string) {
  const agentIdArg = mock.mock.calls[0]?.[0];
  expect(agentIdArg).toHaveProperty('subscribe');
  let observedAgentId: string | undefined;
  const unsubscribe = agentIdArg.subscribe((id: string | undefined) => {
    observedAgentId = id;
  });
  unsubscribe();
  expect(observedAgentId).toBe(expectedAgentId);
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../agent-overview/__tests__/mocks/MockAuggieAvatar.svelte'));
warmImport(() => import('../__tests__/mocks/Fa.svelte'));

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
    expectReadableAgentArg(selectAgentProviderMock, 'codex-agent');
    expect(avatar.parentElement?.classList.contains('grayscale')).toBe(true);
    expect(avatar.parentElement?.classList.contains('opacity-60')).toBe(true);
    expect(document.querySelector('[data-icon="check"]')).toBeNull();
  });

  it('does not re-run provider lookup for same-agent state changes', async () => {
    const { rerender } = render(AugieAvatarWithState, {
      props: { agentId: 'codex-agent', state: 'completed' },
    });

    expect(selectAgentProviderMock).toHaveBeenCalledTimes(1);

    await rerender({ agentId: 'codex-agent', state: 'running' });
    await tick();

    expect(selectAgentProviderMock).toHaveBeenCalledTimes(1);
  });

  it('updates provider-derived completed checkmark when agentId changes on a mounted avatar', async () => {
    const { rerender } = render(AugieAvatarWithState, {
      props: { agentId: 'codex-agent', state: 'completed' },
    });

    expect(document.querySelector('[data-icon="check"]')).toBeNull();

    await rerender({ agentId: 'auggie-agent', state: 'completed' });
    await tick();

    expect(document.querySelector('[data-icon="check"]')).not.toBeNull();
    expect(selectAgentProviderMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the completed checkmark for auggie avatars', () => {
    render(AugieAvatarWithState, { props: { agentId: 'auggie-agent', state: 'completed' } });

    const avatar = screen.getByTestId('mock-auggie-avatar');
    expect(avatar.parentElement?.classList.contains('grayscale')).toBe(true);
    expect(avatar.parentElement?.classList.contains('opacity-60')).toBe(true);
    expect(document.querySelector('[data-icon="check"]')).not.toBeNull();
  });

  it('keeps the completed check indicator outside the grayscale wrapper so it stays colored', () => {
    render(AugieAvatarWithState, { props: { agentId: 'auggie-agent', state: 'completed' } });

    const check = document.querySelector('[data-icon="check"]');
    expect(check).not.toBeNull();
    expect(check?.closest('.grayscale')).toBeNull();
  });

  it('does not apply grayscale to non-completed states', () => {
    for (const state of ['running', 'failed', 'needs-permission', 'waiting', 'idle'] as const) {
      const { unmount } = render(AugieAvatarWithState, {
        props: { agentId: 'auggie-agent', state },
      });
      const avatar = screen.getByTestId('mock-auggie-avatar');
      expect(avatar.parentElement?.classList.contains('grayscale')).toBe(false);
      expect(avatar.parentElement?.classList.contains('opacity-60')).toBe(false);
      unmount();
    }
  });
});
