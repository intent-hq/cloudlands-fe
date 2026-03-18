import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { readable } from 'svelte/store';

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faCheck: { iconName: 'check' },
  faChevronDown: { iconName: 'chevron-down' },
  faLock: { iconName: 'lock' },
  faRotateRight: { iconName: 'rotate-right' },
  faExclamationTriangle: { iconName: 'exclamation-triangle' },
  faTriangleExclamation: { iconName: 'triangle-exclamation' },
}));

vi.mock('$lib/icons/faSettings', () => ({
  faSettings: { iconName: 'settings' },
}));

vi.mock('$lib/components/ui/button/button.svelte', async () => {
  const Button = (await import('../../ui/__tests__/mocks/button.svelte')).default;
  return { default: Button };
});

vi.mock('$lib/components/ui/dropdown', async () => {
  const SlotOnly = (await import('../__tests__/mocks/SlotOnly.svelte')).default;
  return { Dropdown: SlotOnly };
});

vi.mock('$features/agent/agent.client', () => ({
  agentClient: {
    setModel: vi.fn(),
  },
}));

vi.mock('$features/agent/browser', () => ({
  sessionStore: {
    getSession: vi.fn(),
    updateSession: vi.fn(),
  },
}));

vi.mock('$lib/stores/active-provider.store.svelte', () => ({
  activeProviderStore: {
    activeProviderId: 'auggie',
  },
}));

vi.mock('$lib/store/utils/utils', () => ({
  getDispatch: () => vi.fn(),
  getStoreContext: () => undefined,
}));

vi.mock('$lib/store/slices/model/model-selectors', () => ({
  selectSelectedModel: () => readable('gpt5.4'),
  selectAvailableModels: () =>
    readable([{ value: 'gpt5.4', label: 'GPT 5.4', description: 'Smart model' }]),
  selectIsLoadingModels: () => readable(false),
  selectLoadError: () => readable(null),
}));

vi.mock('$lib/store/slices/active-provider/active-provider-selectors', () => ({
  selectActiveProviderId: () => readable('auggie'),
}));

vi.mock('$shared/config/provider-config', () => ({
  getProviderConfig: (providerId?: string) => ({
    id: providerId ?? 'auggie',
    displayName: providerId === 'codex' ? 'OpenAI Codex' : 'Augment Auggie',
  }),
  parseCompoundModelId: (modelId?: string) => {
    if (!modelId) {
      return { providerId: '', modelId: '' };
    }

    const [providerId, ...rest] = modelId.split(':');
    if (rest.length === 0) {
      return { providerId: '', modelId };
    }

    return { providerId, modelId: rest.join(':') };
  },
  resolvePreferredModel: () => undefined,
}));

vi.mock('$shared/types/agent-session', () => ({
  getAgentProvider: vi.fn(() => 'auggie'),
}));

vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToSettings: vi.fn(),
}));

vi.mock('svelte-sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import ModelPicker from './ModelPicker.svelte';

describe('ModelPicker locked state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('shows the locked hover copy and can hide the redundant lock icon', () => {
    render(ModelPicker, {
      props: {
        selectedModel: 'gpt5.4',
        providerId: 'auggie',
        isLocked: true,
        lockedTitle: 'Start a new agent to change provider or model.',
        showLockIconWhenLocked: false,
      },
    });

    const button = screen.getByRole('button');
    expect(button.getAttribute('title')).toBe('Start a new agent to change provider or model.');
    expect(button.textContent).toContain('GPT 5.4');
    expect(button.querySelector('[data-icon="lock"]')).toBeNull();
  });
});