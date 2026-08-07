// @vitest-environment jsdom

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

const mockReduxDispatch = vi.hoisted(() => vi.fn((action: { type?: string; payload?: unknown }) => {
  if (action.type === 'agentSessions/updateSession' && Array.isArray(action.payload)) {
    const [agentId, updates] = action.payload as [string, Partial<Session>];
    sessions.set(agentId, {
      ...(sessions.get(agentId) ?? { id: agentId, workspaceId: 'ws-1' }),
      ...updates,
    });
    sessionVersion$.update((value) => value + 1);
  }
  return action;
}));

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

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');
  // Hydrated catalog with the synthetic `anthropic` provider these regressions
  // use, so the real provider-catalog selectors resolve ids/display names.
  const { initialState, providerCatalogLoaded, providerCatalogReducer } = await import(
    '$store/renderer/slices/provider-catalog/provider-catalog-slice'
  );
  const providerCatalog = providerCatalogReducer(
    initialState,
    providerCatalogLoaded({
      providers: [
        {
          id: 'auggie',
          displayName: 'Auggie',
          shortName: 'Auggie',
          command: 'auggie',
          isDefault: true,
          canBeDisabled: true,
          visible: true,
        },
        {
          id: 'anthropic',
          displayName: 'Anthropic',
          shortName: 'Anthropic',
          command: 'anthropic',
          isDefault: false,
          canBeDisabled: true,
          visible: true,
        },
      ],
      defaultProviderId: 'auggie',
    }),
  );

  return createAppStoreMockModule({
    state: () => ({ sessions, providerCatalog }),
    dispatch: mockReduxDispatch,
  });
});

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => {
  const selectAgentSession = Object.assign(
    (agentIdOrStore: Parameters<typeof selectorForSession>[0]) =>
      selectorForSession(agentIdOrStore),
    { select: (_state: unknown, agentId: string) => sessions.get(agentId) },
  );
  return { selectAgentSession };
});

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => {
  const selectAgentSession = Object.assign(
    (agentIdOrStore: Parameters<typeof selectorForSession>[0]) =>
      selectorForSession(agentIdOrStore),
    { select: (_state: unknown, agentId: string) => sessions.get(agentId) },
  );
  return { selectAgentSession };
});

vi.mock('$store/renderer/slices/agent-session/agent-session-slice', () => ({
  updateSession: (agentId: string, updates: Partial<Session>) => ({
    type: 'agentSessions/updateSession',
    payload: [agentId, updates],
  }),
}));

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectSelectedModel: () => selectedModel$,
  selectAvailableModels: () => availableModels$,
  selectAvailableModelsProviderId: () => writable('auggie'),
  selectModelFallbackInfo: () => writable(null),
  selectModelPickerCollapsedGroups: () => writable([]),
  selectIsLoadingModels: () => isLoadingModels$,
  selectLoadError: () => writable(null),
  selectAllProviderWarnings: () => providerWarnings$,
  selectAllProviderStaleFlags: () => writable({}),
}));

vi.mock('$store/renderer/slices/agent-availability/agent-availability-selectors', () => ({
  selectHasCheckedOnce: () => writable(true),
}));

vi.mock('$store/renderer/slices/daemon-health/daemon-health-selectors', () => ({
  selectDaemonHealth: () => writable('healthy'),
}));

vi.mock('$store/renderer/slices/provider-settings/provider-settings-selectors', () => ({
  selectActiveProviderId: () => activeProviderId$,
  selectAvailableEnabledProviderIds: () => enabledProviderIds$,
}));

vi.mock('$store/renderer/slices/model/model-utils', () => ({
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

vi.mock('$shared/types/agent-session', () => ({
  getAgentProvider: (session: Session) =>
    session.provider ?? (session.metadata?.provider as string | undefined),
  isAgentSession: (session: Session | undefined) => !!session && !('isPending' in session),
  isPendingAgentSession: (session: (Session & { isPending?: boolean }) | undefined) =>
    session?.isPending === true,
}));

vi.mock('$lib/utils/workspace-navigation', () => ({ navigateToSettings: vi.fn() }));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { store as appStore } from '$store/renderer/store';
import { updateSession as updateAgentSessionFields } from '$store/renderer/slices/agent-session/agent-session-slice';
import { getModelsForProviderForLoadingState } from '$store/renderer/slices/model/model-utils';
import ModelPicker from '../ModelPicker.svelte';
import { warmImport } from '../../../../../test/warm-import';

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../../ui/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../../../ui/__tests__/mocks/button.svelte'));
warmImport(() => import('../../__tests__/mocks/SlotOnly.svelte'));
warmImport(() => import('../../__tests__/mocks/ProviderIcon.svelte'));

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

  it('treats provider-prefixed *:default ids as explicit selections', () => {
    availableModels$.set([
      { value: 'auggie:butler', label: 'Auggie Butler' },
      { value: 'claude-code:default', label: 'Default (recommended)' },
    ]);

    render(ModelPicker, {
      props: {
        selectedModel: 'claude-code:default',
        defaultModelId: 'auggie:butler',
        isLocked: true,
      },
    });

    const text = screen.getByRole('button').textContent ?? '';
    expect(text).toContain('Default (recommended)');
    expect(text).not.toContain('Auggie Butler');
    expect(screen.getByTestId('provider-icon').getAttribute('data-provider-id')).toBe(
      'claude-code',
    );
  });

  it('still renders the default-model fallback label for the bare "default" sentinel', () => {
    render(ModelPicker, {
      props: {
        selectedModel: 'default',
        defaultModelId: 'auggie:butler',
        isLocked: true,
      },
    });

    const text = screen.getByRole('button').textContent ?? '';
    expect(text).toContain('Auggie Butler');
    expect(text).not.toContain('Default (recommended)');
  });

  it('renders the default-model fallback label for undefined and __use_default__ selections', async () => {
    const { rerender } = render(ModelPicker, {
      props: {
        selectedModel: undefined,
        defaultModelId: 'auggie:butler',
        isLocked: true,
      },
    });

    expect(screen.getByRole('button').textContent ?? '').toContain('Auggie Butler');

    await rerender({
      selectedModel: '__use_default__',
      defaultModelId: 'auggie:butler',
      isLocked: true,
    });
    await tick();

    expect(screen.getByRole('button').textContent ?? '').toContain('Auggie Butler');
  });

  it('prefers defaultModelLabel when defaultModelId cannot be resolved to a label', () => {
    availableModels$.set([]);

    render(ModelPicker, {
      props: {
        selectedModel: undefined,
        defaultModelId: 'auggie:not-loaded-yet',
        defaultModelLabel: 'Provider default',
        isLocked: true,
      },
    });

    const text = screen.getByRole('button').textContent ?? '';
    expect(text).toContain('Provider default');
    expect(text).not.toContain('Default model');
  });

  it('falls back to the bare model id for an unresolvable defaultModelId without defaultModelLabel', () => {
    availableModels$.set([]);

    render(ModelPicker, {
      props: {
        selectedModel: undefined,
        defaultModelId: 'auggie:not-loaded-yet',
        isLocked: true,
      },
    });

    const text = screen.getByRole('button').textContent ?? '';
    expect(text).toContain('not-loaded-yet');
    expect(text).not.toContain('Default model');
  });

  it('derives the trigger icon from a bare defaultModelId (default provider) instead of the active provider', () => {
    activeProviderId$.set('anthropic');

    render(ModelPicker, {
      props: {
        selectedModel: undefined,
        defaultModelId: 'butler',
        isLocked: true,
      },
    });

    expect(screen.getByTestId('provider-icon').getAttribute('data-provider-id')).toBe('auggie');
  });

  it('derives the trigger icon from a compound defaultModelId instead of the active provider', () => {
    activeProviderId$.set('auggie');

    render(ModelPicker, {
      props: {
        selectedModel: undefined,
        defaultModelId: 'anthropic:claude-opus-4-7',
        isLocked: true,
      },
    });

    expect(screen.getByTestId('provider-icon').getAttribute('data-provider-id')).toBe(
      'anthropic',
    );
  });

  it('prefers an explicit providerId prop over the defaultModelId for the trigger icon', () => {
    render(ModelPicker, {
      props: {
        selectedModel: undefined,
        providerId: 'anthropic',
        defaultModelId: 'auggie:butler',
        isLocked: true,
      },
    });

    expect(screen.getByTestId('provider-icon').getAttribute('data-provider-id')).toBe(
      'anthropic',
    );
  });

  it('falls back to the active provider when no model or provider is resolvable', () => {
    activeProviderId$.set('anthropic');

    render(ModelPicker, {
      props: {
        selectedModel: undefined,
        isLocked: true,
      },
    });

    expect(screen.getByTestId('provider-icon').getAttribute('data-provider-id')).toBe(
      'anthropic',
    );
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

    appStore.dispatch(
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
