// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { writable } from 'svelte/store';

type ModelOption = { value: string; label: string; description?: string };
type Session = {
  id: string;
  workspaceId: string;
  provider?: string;
  model?: string;
  metadata?: Record<string, unknown>;
};

const selectedModel$ = writable<string | undefined>('auggie:butler');
const availableModels$ = writable<ModelOption[]>([]);
const isLoadingModels$ = writable(false);
const activeProviderId$ = writable('auggie');
const enabledProviderIds$ = writable(['auggie']);
const providerWarnings$ = writable<Record<string, string>>({});
const sessionVersion$ = writable(0);
const sessions = new Map<string, Session>();

const mockReduxDispatch = vi.fn((action: { type?: string; payload?: unknown }) => {
  if (action.type === 'agentSessions/updateSession' && Array.isArray(action.payload)) {
    const [agentId, updates] = action.payload as [string, Partial<Session>];
    sessions.set(agentId, {
      ...(sessions.get(agentId) ?? { id: agentId, workspaceId: 'ws-1' }),
      ...updates,
    });
    sessionVersion$.update((value) => value + 1);
  }
  return action;
});

function selectorForSession(
  agentIdOrStore: string | { subscribe: (run: (value: string) => void) => () => void },
) {
  return {
    subscribe(run: (value: Session | undefined) => void) {
      let currentAgentId = typeof agentIdOrStore === 'string' ? agentIdOrStore : '';
      const emit = () => run(sessions.get(currentAgentId));
      const unsubscribeId =
        typeof agentIdOrStore === 'string'
          ? undefined
          : agentIdOrStore.subscribe((value) => {
              currentAgentId = value;
              emit();
            });
      const unsubscribeVersion = sessionVersion$.subscribe(emit);
      return () => {
        unsubscribeId?.();
        unsubscribeVersion();
      };
    },
  };
}

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faCheck: { iconName: 'check' },
  faChevronDown: { iconName: 'chevron-down' },
  faCircleNotch: { iconName: 'circle-notch' },
  faLock: { iconName: 'lock' },
  faArrowsRotate: { iconName: 'arrows-rotate' },
  faExclamationTriangle: { iconName: 'exclamation-triangle' },
  faTriangleExclamation: { iconName: 'triangle-exclamation' },
}));

vi.mock('$lib/icons/faSettings', () => ({
  faSettings: { iconName: 'settings' },
}));

vi.mock('$lib/components/ui/button/button.svelte', async () => {
  const Button = (await import('../../../ui/__tests__/mocks/button.svelte')).default;
  return { default: Button };
});

vi.mock('$lib/components/ui/dropdown', async () => {
  const SlotOnly = (await import('../../__tests__/mocks/SlotOnly.svelte')).default;
  return { Dropdown: SlotOnly };
});

vi.mock('$lib/components/ui/ProviderIcon.svelte', async () => {
  const ProviderIcon = (await import('../../__tests__/mocks/ProviderIcon.svelte')).default;
  return { default: ProviderIcon };
});

vi.mock('$features/agent/agent.client', () => ({
  agentClient: {
    setModel: vi.fn(() => Promise.resolve({ ok: true, data: { success: true } })),
  },
}));

vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  getReduxStore: () => ({
    getState: () => ({ sessions }),
    dispatch: mockReduxDispatch,
  }),
}));

vi.mock('$lib/store/utils/svelte-context', () => ({
  getDispatch: () => vi.fn(),
  getStoreContext: () => undefined,
}));

vi.mock('$lib/store/slices/workspace-agents/workspace-agents-selectors', () => {
  const selectAgentById = Object.assign(
    (agentIdOrStore: Parameters<typeof selectorForSession>[0]) =>
      selectorForSession(agentIdOrStore),
    { select: (_state: unknown, agentId: string) => sessions.get(agentId) },
  );
  return { selectAgentById };
});

vi.mock('$lib/store/slices/agent-session/agent-session-slice', () => ({
  updateSession: (agentId: string, updates: Partial<Session>) => ({
    type: 'agentSessions/updateSession',
    payload: [agentId, updates],
  }),
}));

vi.mock('$lib/store/slices/model/model-selectors', () => ({
  selectSelectedModel: () => selectedModel$,
  selectAvailableModels: () => availableModels$,
  selectModelFallbackInfo: () => writable(null),
  selectModelPickerCollapsedGroups: () => writable([]),
  selectIsLoadingModels: () => isLoadingModels$,
  selectLoadError: () => writable(null),
  selectAllProviderWarnings: () => providerWarnings$,
}));

vi.mock('$lib/store/slices/agent-availability/agent-availability-selectors', () => ({
  selectManagedInstallStatusByProvider: () => writable(null),
}));

vi.mock('$lib/store/slices/provider-settings/provider-settings-selectors', () => ({
  selectActiveProviderId: () => activeProviderId$,
  selectEnabledProviderIds: () => enabledProviderIds$,
}));

vi.mock('$lib/store/slices/model/model-utils', () => ({
  getModelsForProvider: vi.fn((providerId: string) => {
    if (providerId === 'anthropic') {
      return Promise.resolve([{ value: 'anthropic:claude-opus-4-7', label: 'Claude Opus 4.7' }]);
    }
    return Promise.resolve([{ value: 'auggie:butler', label: 'Auggie Butler' }]);
  }),
  getModelsForProviderForLoadingState: vi.fn((providerId: string) => {
    const models =
      providerId === 'anthropic'
        ? [{ value: 'anthropic:claude-opus-4-7', label: 'Claude Opus 4.7' }]
        : [{ value: 'auggie:butler', label: 'Auggie Butler' }];
    return Promise.resolve({ models });
  }),
}));

vi.mock('$shared/config/provider-config', () => ({
  ACP_PROVIDERS: {
    auggie: { id: 'auggie', displayName: 'Auggie' },
    anthropic: { id: 'anthropic', displayName: 'Anthropic' },
  },
  getDefaultProviderId: () => 'auggie',
  getProviderConfig: (providerId?: string) => ({
    id: providerId || 'auggie',
    displayName: providerId || 'auggie',
    command: providerId || 'auggie',
  }),
  isProviderAuthenticationError: () => false,
  parseCompoundModelId: (modelId?: string) => {
    if (!modelId) return { providerId: 'auggie', modelId: '' };
    const [providerId, ...rest] = modelId.split(':');
    return rest.length
      ? { providerId, modelId: rest.join(':') }
      : { providerId: 'auggie', modelId };
  },
  resolvePreferredModel: () => undefined,
}));

vi.mock('$shared/types/agent-session', () => ({
  getAgentProvider: (session: Session) =>
    session.provider ?? (session.metadata?.provider as string | undefined),
}));

vi.mock('$lib/utils/workspace-navigation', () => ({ navigateToSettings: vi.fn() }));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
import { updateSession as updateAgentSessionFields } from '$lib/store/slices/agent-session/agent-session-slice';
import { getModelsForProviderForLoadingState } from '$lib/store/slices/model/model-utils';
import ModelPicker from '../ModelPicker.svelte';

describe('ModelPicker trigger label regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessions.clear();
    sessionVersion$.set(0);
    selectedModel$.set('auggie:butler');
    availableModels$.set([
      { value: 'auggie:butler', label: 'Auggie Butler' },
      { value: 'anthropic:claude-opus-4-7', label: 'Claude Opus 4.7' },
    ]);
    isLoadingModels$.set(false);
    activeProviderId$.set('auggie');
    enabledProviderIds$.set(['auggie']);
    providerWarnings$.set({});
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('renders the selected model label instead of the first available model label', () => {
    render(ModelPicker, {
      props: {
        selectedModel: 'anthropic:claude-opus-4-7',
        isLocked: true,
      },
    });

    const text = screen.getByRole('button').textContent ?? '';
    expect(text).toContain('Claude Opus 4.7');
    expect(text).not.toContain('Auggie Butler');
  });

  it('does not silently flip to the first available model when selectedModel becomes undefined', async () => {
    const { rerender } = render(ModelPicker, {
      props: {
        selectedModel: 'anthropic:claude-opus-4-7',
        isLocked: true,
      },
    });

    await rerender({ selectedModel: undefined, isLocked: true });
    await tick();

    const text = screen.getByRole('button').textContent ?? '';
    expect(text).toContain('Default model');
    expect(text).not.toContain('Auggie Butler');
  });

  it('reacts when the Redux session provider changes without remounting', async () => {
    sessions.set('agent-1', { id: 'agent-1', workspaceId: 'ws-1', provider: 'auggie' });
    sessionVersion$.update((value) => value + 1);

    render(ModelPicker, {
      props: {
        selectedModel: undefined,
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        isLocked: true,
      },
    });

    expect(screen.getByTestId('provider-icon').getAttribute('data-provider-id')).toBe('auggie');

    getReduxStore().dispatch(
      updateAgentSessionFields('agent-1', {
        provider: 'anthropic',
        model: 'anthropic:claude-opus-4-7',
      }),
    );

    await tick();
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(screen.getByTestId('provider-icon').getAttribute('data-provider-id')).toBe('anthropic');
    expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('anthropic');
  });
});
