import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';

const { selectAgentIsThinkingMock, getRandomColorsWithSeedMock } = vi.hoisted(() => ({
  selectAgentIsThinkingMock: vi.fn((agentId: string) => ({
    subscribe: (run: (value: boolean) => void) => {
      run(agentId === 'thinking-agent');
      return () => {};
    },
  })),
  getRandomColorsWithSeedMock: vi.fn(() => ['#111111', '#222222'] as const),
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentIsThinking: selectAgentIsThinkingMock,
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
    getRandomColorsWithSeedMock.mockClear();
  });

  afterEach(() => cleanup());

  it('subscribes to selectAgentIsThinking(agentId) and animates the specialist icon', () => {
    const { container } = render(AuggieAvatar, {
      props: { agentId: 'thinking-agent', size: 20, specialist: 'implementor' },
    });

    expect(selectAgentIsThinkingMock).toHaveBeenCalledWith('thinking-agent');
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
});
