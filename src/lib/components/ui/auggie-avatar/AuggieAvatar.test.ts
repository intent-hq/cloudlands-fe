import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';

type ReadableArg<T> = T | { subscribe: (run: (value: T) => void) => () => void };

const { selectAgentIsThinkingMock, selectAgentProviderMock, getRandomColorsWithSeedMock } = vi.hoisted(() => ({
  selectAgentIsThinkingMock: vi.fn((agentId: ReadableArg<string>) => ({
    subscribe: (run: (value: boolean) => void) => {
      if (typeof agentId === 'string') {
        run(agentId.includes('thinking'));
        return () => {};
      }
      return agentId.subscribe((id) => run(id.includes('thinking')));
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
  getRandomColorsWithSeedMock: vi.fn(() => ['#111111', '#222222'] as const),
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentIsThinking: selectAgentIsThinkingMock,
  selectAgentProvider: selectAgentProviderMock,
}));

vi.mock('$store/renderer/slices/theme/theme-selectors', () => ({
  selectIsDarkTheme: vi.fn(() => ({
    subscribe: (run: (value: boolean) => void) => {
      run(false);
      return () => {};
    },
  })),
}));

vi.mock('./avatar-constants', () => ({
  getRandomColorsWithSeed: getRandomColorsWithSeedMock,
}));

import AuggieAvatar from './AuggieAvatar.svelte';

describe('AuggieAvatar Thinking selector ownership', () => {
  beforeEach(() => {
    selectAgentIsThinkingMock.mockClear();
    selectAgentProviderMock.mockClear();
    getRandomColorsWithSeedMock.mockClear();
  });

  afterEach(() => cleanup());

  it('subscribes to selectAgentIsThinking(agentId) and animates the specialist icon', () => {
    const { container } = render(AuggieAvatar, {
      props: { agentId: 'thinking-agent', size: 20, specialist: 'implementor' },
    });

    expect(selectAgentIsThinkingMock).toHaveBeenCalledOnce();
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

    expect(selectAgentProviderMock).toHaveBeenCalledOnce();
    expect(container.querySelector('svg[role="img"][viewBox="0 0 24 24"]')).not.toBeNull();
    expect(container.querySelector('svg[viewBox="0 1 20 12.3"]')).toBeNull();
  });

  it('updates provider icon and thinking state when agentId changes on a mounted avatar', async () => {
    const { container, rerender } = render(AuggieAvatar, {
      props: { agentId: 'codex-thinking-agent', size: 20, specialist: 'implementor' },
    });

    expect(container.querySelector('svg[role="img"][viewBox="0 0 24 24"]')).not.toBeNull();
    expect(container.querySelector('.animate-thinking')).not.toBeNull();

    await rerender({ agentId: 'auggie-agent', size: 20, specialist: 'implementor' });
    await tick();

    expect(container.querySelector('svg[role="img"][viewBox="0 0 24 24"]')).toBeNull();
    expect(container.querySelector('svg[viewBox="0 1 20 12.3"]')).not.toBeNull();
    expect(container.querySelector('.animate-thinking')).toBeNull();
  });

  it('keeps the auggie logo for auggie and providerless avatars', () => {
    const auggie = render(AuggieAvatar, { props: { agentId: 'auggie-agent', size: 20 } });
    expect(auggie.container.querySelector('svg[viewBox="0 1 20 12.3"]')).not.toBeNull();
    cleanup();

    const seedOnly = render(AuggieAvatar, { props: { seed: 'seed-only', size: 20 } });
    expect(seedOnly.container.querySelector('svg[viewBox="0 1 20 12.3"]')).not.toBeNull();
  });
});
