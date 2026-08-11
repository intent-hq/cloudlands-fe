import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';

const {
  selectAgentIsThinkingMock,
  selectAgentProviderMock,
  getRandomColorsWithSeedMock,
  darkThemeState,
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
    selectAgentIsThinkingMock: vi.fn((agentId: string | ReadableLike<string | undefined>) => ({
      subscribe: (run: (value: boolean) => void) => {
        if (agentId && typeof agentId !== 'string') {
          return agentId.subscribe((id) => run(id?.includes('thinking') === true));
        }
        run(agentId.includes('thinking'));
        return () => {};
      },
    })),
    selectAgentProviderMock,
    getRandomColorsWithSeedMock: vi.fn(() => ['#111111', '#222222'] as const),
    darkThemeState: { current: false },
  };
});

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentIsThinking: selectAgentIsThinkingMock,
  selectAgentProvider: selectAgentProviderMock,
}));

vi.mock('$store/renderer/store', () => ({
  store: { state: {} },
}));

vi.mock('$store/renderer/slices/theme/theme-selectors', () => ({
  selectIsDarkTheme: vi.fn(() => ({
    subscribe: (run: (value: boolean) => void) => {
      run(darkThemeState.current);
      return () => {};
    },
  })),
}));

vi.mock('./avatar-constants', () => ({
  getRandomColorsWithSeed: getRandomColorsWithSeedMock,
}));

import AuggieAvatar from './AuggieAvatar.svelte';

// CSS attribute selectors lowercase attribute names in HTML documents, so
// `svg[viewBox=...]` never matches the case-sensitive SVG attribute (jsdom >= 30
// matches browser behavior here). Query by getAttribute instead.
function querySvgByViewBox(root: Element, viewBox: string, role?: string) {
  return (
    Array.from(root.querySelectorAll('svg')).find(
      (svg) =>
        svg.getAttribute('viewBox') === viewBox &&
        (role === undefined || svg.getAttribute('role') === role),
    ) ?? null
  );
}

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

describe('AuggieAvatar Thinking selector ownership', () => {
  beforeEach(() => {
    darkThemeState.current = false;
    selectAgentIsThinkingMock.mockClear();
    selectAgentProviderMock.mockClear();
    getRandomColorsWithSeedMock.mockClear();
  });

  afterEach(() => cleanup());

  it('subscribes to selectAgentIsThinking(agentIdStore) and animates the specialist icon', () => {
    const { container } = render(AuggieAvatar, {
      props: { agentId: 'thinking-agent', size: 20, specialist: 'implementor' },
    });

    expectReadableAgentArg(selectAgentIsThinkingMock, 'thinking-agent');
    expect(container.querySelector('.animate-thinking')).not.toBeNull();
  });

  it('uses agentId for deterministic avatar color seeding', () => {
    render(AuggieAvatar, { props: { agentId: 'agent-1', seed: 'fallback-seed', size: 20 } });

    expect(getRandomColorsWithSeedMock).toHaveBeenCalledWith('agent-1', false);
  });

  it('uses a transparent fallback when no seed or agentId is provided', () => {
    const { container } = render(AuggieAvatar, { props: { size: 20 } });
    const stops = Array.from(container.querySelectorAll('stop')).map((stop) =>
      stop.getAttribute('stop-color'),
    );

    expect(stops).toEqual(['transparent', 'transparent']);
    expect(getRandomColorsWithSeedMock).not.toHaveBeenCalled();
  });

  it('uses the theme foreground for a backgroundless auggie mark in dark mode', () => {
    darkThemeState.current = true;
    const { container } = render(AuggieAvatar, { props: { size: 20 } });

    const logo = container.querySelector('svg[viewBox="0 1 20 12.3"]');
    expect(logo?.classList.contains('text-foreground')).toBe(true);
    expect(logo?.classList.contains('text-gray-900')).toBe(false);
  });

  it('keeps the dark auggie mark when the avatar has a background color in dark mode', () => {
    darkThemeState.current = true;
    const { container } = render(AuggieAvatar, { props: { seed: 'colored-avatar', size: 20 } });

    const logo = container.querySelector('svg[viewBox="0 1 20 12.3"]');
    expect(logo?.classList.contains('text-gray-900')).toBe(true);
    expect(logo?.classList.contains('text-foreground')).toBe(false);
  });

  it('uses a visible muted fallback in dark mode when no seed or agentId is provided', () => {
    darkThemeState.current = true;
    const { container } = render(AuggieAvatar, { props: { size: 20 } });
    const stops = Array.from(container.querySelectorAll('stop')).map((stop) =>
      stop.getAttribute('stop-color'),
    );

    expect(stops).toEqual(['var(--color-muted-foreground)', 'var(--color-muted-foreground)']);
    expect(getRandomColorsWithSeedMock).not.toHaveBeenCalled();
  });

  it('keeps seeded avatars colorful in light mode', () => {
    const { container } = render(AuggieAvatar, { props: { seed: 'foo', size: 20 } });
    const stops = Array.from(container.querySelectorAll('stop')).map((stop) =>
      stop.getAttribute('stop-color'),
    );

    expect(getRandomColorsWithSeedMock).toHaveBeenCalledWith('foo', false);
    expect(stops).toEqual(['#111111', '#222222']);
    expect(stops).not.toEqual(['#D1D5DB', '#9CA3AF']);
  });

  it('renders the provider icon for known non-auggie agent providers', () => {
    const { container } = render(AuggieAvatar, { props: { agentId: 'codex-agent', size: 20 } });

    expectReadableAgentArg(selectAgentProviderMock, 'codex-agent');
    expect(querySvgByViewBox(container, '0 0 24 24', 'img')).not.toBeNull();
    expect(querySvgByViewBox(container, '0 1 20 12.3')).toBeNull();
  });

  it('does not re-run provider lookup for unrelated avatar prop updates', async () => {
    const { rerender } = render(AuggieAvatar, { props: { agentId: 'codex-agent', size: 20 } });

    expect(selectAgentProviderMock).toHaveBeenCalledTimes(1);

    await rerender({ agentId: 'codex-agent', size: 24 });
    await tick();

    expect(selectAgentProviderMock).toHaveBeenCalledTimes(1);
  });

  it('updates provider and thinking state when agentId changes on a mounted avatar', async () => {
    const { container, rerender } = render(AuggieAvatar, {
      props: { agentId: 'codex-thinking-agent', size: 20, specialist: 'implementor' },
    });

    expect(querySvgByViewBox(container, '0 0 24 24', 'img')).not.toBeNull();
    expect(container.querySelector('.animate-thinking')).not.toBeNull();

    await rerender({ agentId: 'auggie-agent', size: 20, specialist: 'implementor' });
    await tick();

    expect(querySvgByViewBox(container, '0 0 24 24', 'img')).toBeNull();
    expect(querySvgByViewBox(container, '0 1 20 12.3')).not.toBeNull();
    expect(container.querySelector('.animate-thinking')).toBeNull();
    expect(selectAgentProviderMock).toHaveBeenCalledTimes(1);
    expect(selectAgentIsThinkingMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the auggie logo for auggie and providerless avatars', () => {
    const auggie = render(AuggieAvatar, { props: { agentId: 'auggie-agent', size: 20 } });
    expect(querySvgByViewBox(auggie.container, '0 1 20 12.3')).not.toBeNull();
    cleanup();

    const seedOnly = render(AuggieAvatar, { props: { seed: 'seed-only', size: 20 } });
    expect(querySvgByViewBox(seedOnly.container, '0 1 20 12.3')).not.toBeNull();
  });
});
