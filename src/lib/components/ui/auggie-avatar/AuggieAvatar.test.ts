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
} from '@testing-library/svelte';

const { selectAgentIsThinkingMock, getRandomColorsWithSeedMock } = vi.hoisted(() => ({
  selectAgentIsThinkingMock: vi.fn((agentId: string) => ({
    subscribe: (run: (value: boolean) => void) => {
      run(agentId === 'thinking-agent');
      return () => {};
    },
  })),
  getRandomColorsWithSeedMock: vi.fn(() => ['#111111', '#222222'] as const),
}));

vi.mock('$lib/store/slices/agent-session/agent-session-selectors', () => ({
  selectAgentIsThinking: selectAgentIsThinkingMock,
}));

vi.mock('$lib/store/slices/theme/theme-selectors', () => ({
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
});