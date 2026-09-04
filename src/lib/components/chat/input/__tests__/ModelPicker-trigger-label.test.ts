// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { readable, writable } from 'svelte/store';

type ModelOption = {
  value: string;
  label: string;
  description?: string;
  isDefault?: boolean;
  isLegacyModel?: boolean;
};
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

const mockReduxDispatch = vi.hoisted(() =>
  vi.fn((action: { type?: string; payload?: unknown }) => {
    if (action.type === 'agentSessions/updateSession' && Array.isArray(action.payload)) {
      const [agentId, updates] = action.payload as [string, Partial<Session>];
      sessions.set(agentId, {
        ...(sessions.get(agentId) ?? { id: agentId, workspaceId: 'ws-1' }),
        ...updates,
      });
      sessionVersion$.update((value) => value + 1);
    }
    return action;
  }),
);

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
  faSettings: { iconName: 'gear' },
}));

vi.mock('$lib/components/ui/button/button.svelte', async () => {
  const Button = (await import('../../../ui/__tests__/mocks/button.svelte')).default;
  return { default: Button };
});

vi.mock('$lib/components/ui/dropdown', async () => {
  const SlotOnly = (await import('../../__tests__/mocks/SlotOnly.svelte')).default;
  return { Dropdown: SlotOnly };
});

vi.mock('$features/agent/components/AgentProviderIcon.svelte', async () => {
  const mod = await import('../../__tests__/mocks/ProviderIcon.svelte');
  return { default: mod.default, hasProviderIcon: mod.hasProviderIcon };
});

vi.mock('$features/agent/agent.client', () => ({
  agentClient: {
    setModel: vi.fn(() => Promise.resolve({ ok: true, data: { success: true } })),
  },
}));

vi.mock('$features/agent/reasoning-effort', () => ({
  applyReasoningEffort: vi.fn(async () => true),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  // Hydrated catalog with the synthetic `anthropic` provider these regressions
  // use, so the real provider-catalog selectors resolve ids/display names.
  const { initialState, providerCatalogLoaded, providerCatalogReducer } =
    await import('$store/renderer/slices/provider-catalog/provider-catalog-slice');
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
        {
          id: 'claude-code',
          displayName: 'Claude Code',
          shortName: 'Claude',
          command: 'claude-code',
          isDefault: false,
          canBeDisabled: true,
          visible: true,
        },
        {
          id: 'codex',
          displayName: 'Codex',
          shortName: 'Codex',
          command: 'codex',
          isDefault: false,
          canBeDisabled: true,
          visible: true,
        },
      ],
      defaultProviderId: 'auggie',
    }),
  );

  return createAppStoreMockModule({
    state: () => ({
      sessions,
      providerCatalog,
      providerSettings: { enabledProviders: {} },
      model: { defaultProviderId: 'auggie' },
    }),
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
  const selectAgentReasoningEffort = Object.assign(() => writable(undefined), {
    select: () => undefined,
  });
  return { selectAgentSession, selectAgentReasoningEffort };
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
  selectAgentModelEffortLevels: () => writable(undefined),
}));

vi.mock('$store/renderer/slices/agent-availability/agent-availability-selectors', () => ({
  selectHasCheckedOnce: () => writable(true),
}));

vi.mock('$store/renderer/slices/daemon-health/daemon-health-selectors', () => ({
  selectDaemonHealth: () => writable('healthy'),
}));

vi.mock('$store/renderer/slices/provider-settings/provider-settings-selectors', () => ({
  selectActiveProviderId: () => activeProviderId$,
  selectModelFetchProviderIds: () => enabledProviderIds$,
  selectIsProviderModelAccessAllowed: () => readable(true),
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
        : providerId === 'claude-code'
          ? [{ value: 'claude-code:claude-opus-4-8', label: 'Claude Opus 4.8', isDefault: true }]
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

  it('resolves a bare session model id against a provider-prefixed catalog row', async () => {
    // Daemon-pinned bare id (intent-hq/monorepo#3302): the loaded catalog row
    // for a non-default provider is `provider:model`-prefixed, so an exact-id
    // lookup misses and the raw id renders.
    enabledProviderIds$.set(['auggie', 'claude-code']);
    availableModels$.set([]);

    render(ModelPicker, {
      props: {
        selectedModel: 'claude-opus-4-8',
        providerId: 'claude-code',
        isLocked: true,
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    await tick();

    const text = screen.getByRole('button').textContent ?? '';
    expect(text).toContain('Claude Opus 4.8');
    expect(text).not.toContain('claude-opus-4-8');
  });

  it('resolves a provider-prefixed session model id against a bare catalog row', () => {
    // The default provider's catalog rows are bare (prefixModelsForProvider),
    // so a stored compound id must still match them.
    availableModels$.set([{ value: 'butler', label: 'Auggie Butler' }]);

    render(ModelPicker, {
      props: {
        selectedModel: 'auggie:butler',
        isLocked: true,
      },
    });

    const text = screen.getByRole('button').textContent ?? '';
    expect(text).toContain('Auggie Butler');
    expect(text).not.toContain('auggie:butler');
  });

  it('suffixes the effort of a legacy compound id whose base only matches a prefixed row', async () => {
    enabledProviderIds$.set(['auggie', 'claude-code']);
    availableModels$.set([]);

    render(ModelPicker, {
      props: {
        selectedModel: 'claude-opus-4-8/high',
        providerId: 'claude-code',
        isLocked: true,
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    await tick();

    expect(screen.getByRole('button').textContent ?? '').toContain('Claude Opus 4.8 (High)');
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
        defaultModelId: 'claude-code:claude-opus-4-7',
        isLocked: true,
      },
    });

    expect(screen.getByTestId('provider-icon').getAttribute('data-provider-id')).toBe(
      'claude-code',
    );
  });

  it('prefers an explicit providerId prop over the defaultModelId for the trigger icon', () => {
    render(ModelPicker, {
      props: {
        selectedModel: undefined,
        providerId: 'auggie',
        defaultModelId: 'claude-code:butler',
        isLocked: true,
      },
    });

    expect(screen.getByTestId('provider-icon').getAttribute('data-provider-id')).toBe('auggie');
  });

  it('falls back to the active provider when no model or provider is resolvable', () => {
    activeProviderId$.set('claude-code');

    render(ModelPicker, {
      props: {
        selectedModel: undefined,
        isLocked: true,
      },
    });

    expect(screen.getByTestId('provider-icon').getAttribute('data-provider-id')).toBe(
      'claude-code',
    );
  });

  it('reacts when the Redux session provider changes without remounting', async () => {
    selectedModel$.set(undefined);
    activeProviderId$.set('codex');
    sessions.set('agent-1', { id: 'agent-1', workspaceId: 'ws-1', provider: 'codex' });
    sessionVersion$.update((value) => value + 1);

    render(ModelPicker, {
      props: {
        selectedModel: undefined,
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        isLocked: true,
      },
    });

    expect(screen.getByTestId('provider-icon').getAttribute('data-provider-id')).toBe('codex');

    appStore.dispatch(
      updateAgentSessionFields('agent-1', {
        provider: 'claude-code',
        model: 'claude-code:claude-opus-4-7',
      }),
    );

    await tick();
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(screen.getByTestId('provider-icon').getAttribute('data-provider-id')).toBe(
      'claude-code',
    );
    expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('claude-code');
  });

  it('does not render a provider icon for unknown provider IDs', () => {
    activeProviderId$.set('anthropic');

    render(ModelPicker, {
      props: {
        selectedModel: undefined,
        isLocked: true,
      },
    });

    expect(screen.queryByTestId('provider-icon')).toBeNull();
  });

  it('falls back to the catalog isDefault row when the daemon preview is absent (opt-in)', () => {
    availableModels$.set([
      { value: 'auggie:butler', label: 'Auggie Butler' },
      { value: 'auggie:sonnet-4.6', label: 'Sonnet 4.6', isDefault: true },
    ]);

    render(ModelPicker, {
      props: {
        selectedModel: undefined,
        defaultModelLabel: 'Provider default',
        fallbackToCatalogDefault: true,
        isLocked: true,
      },
    });

    const text = screen.getByRole('button').textContent ?? '';
    expect(text).toContain('Sonnet 4.6');
    expect(text).not.toContain('Provider default');
  });

  it('keeps the defaultModelLabel when no catalog row is marked isDefault', () => {
    availableModels$.set([{ value: 'auggie:butler', label: 'Auggie Butler' }]);

    render(ModelPicker, {
      props: {
        selectedModel: undefined,
        defaultModelLabel: 'Provider default',
        fallbackToCatalogDefault: true,
        isLocked: true,
      },
    });

    expect(screen.getByRole('button').textContent ?? '').toContain('Provider default');
  });

  it('does not use the catalog isDefault fallback when a daemon preview (defaultModelId) resolves', () => {
    availableModels$.set([
      { value: 'auggie:butler', label: 'Auggie Butler' },
      { value: 'auggie:sonnet-4.6', label: 'Sonnet 4.6', isDefault: true },
    ]);

    render(ModelPicker, {
      props: {
        selectedModel: undefined,
        defaultModelId: 'auggie:butler',
        defaultModelLabel: 'Provider default',
        fallbackToCatalogDefault: true,
        isLocked: true,
      },
    });

    const text = screen.getByRole('button').textContent ?? '';
    expect(text).toContain('Auggie Butler');
    expect(text).not.toContain('Sonnet 4.6');
  });

  it('reads the fallbackProviderId provider for the catalog isDefault fallback, not the active provider', async () => {
    enabledProviderIds$.set(['auggie', 'claude-code']);
    availableModels$.set([
      { value: 'auggie:butler', label: 'Auggie Butler' },
      { value: 'auggie:sonnet-4.6', label: 'Sonnet 4.6', isDefault: true },
    ]);

    render(ModelPicker, {
      props: {
        selectedModel: undefined,
        defaultModelLabel: 'Provider default',
        fallbackToCatalogDefault: true,
        fallbackProviderId: 'claude-code',
        isLocked: true,
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    await tick();

    const text = screen.getByRole('button').textContent ?? '';
    expect(text).toContain('Claude Opus 4.8');
    expect(text).not.toContain('Sonnet 4.6');
    expect(screen.getByTestId('provider-icon').getAttribute('data-provider-id')).toBe(
      'claude-code',
    );
  });

  it('maps a legacy <provider>:default selection to the catalog isDefault row', () => {
    availableModels$.set([
      { value: 'auggie:butler', label: 'Auggie Butler' },
      { value: 'auggie:sonnet-4.6', label: 'Sonnet 4.6', isDefault: true },
    ]);

    render(ModelPicker, {
      props: {
        selectedModel: 'auggie:default',
        isLocked: true,
      },
    });

    const text = screen.getByRole('button').textContent ?? '';
    expect(text).toContain('Sonnet 4.6');
    expect(text).not.toContain('default');
  });

  it('falls back to the first known model row for a <provider>:default selection with no isDefault row (D2)', () => {
    availableModels$.set([{ value: 'auggie:butler', label: 'Auggie Butler' }]);

    render(ModelPicker, {
      props: {
        selectedModel: 'auggie:default',
        isLocked: true,
      },
    });

    const text = screen.getByRole('button').textContent ?? '';
    expect(text).toContain('Auggie Butler');
    expect(text).not.toContain('default');
  });

  it('D2 skips legacy rows: maps to the first non-legacy row, not raw catalog order', () => {
    // Reviewer example shape: the first non-pseudo catalog row is a legacy
    // row. The group builder renders legacy rows in a separate trailing
    // subgroup, so the first *rendered* row is the non-legacy one — the D2
    // mapping must land there, not on the legacy row.
    availableModels$.set([
      { value: 'auggie:default', label: 'Default (recommended)' },
      { value: 'auggie:old', label: 'Auggie Old', isLegacyModel: true },
      { value: 'auggie:sonnet', label: 'Sonnet 4.6' },
    ]);

    render(ModelPicker, {
      props: {
        selectedModel: 'auggie:default',
        isLocked: true,
      },
    });

    const text = screen.getByRole('button').textContent ?? '';
    expect(text).toContain('Sonnet 4.6');
    expect(text).not.toContain('Auggie Old');
    expect(text).not.toContain('Default (recommended)');
  });

  it('renders the raw id for a <provider>:default selection while the catalog is cold', () => {
    availableModels$.set([]);

    render(ModelPicker, {
      props: {
        selectedModel: 'auggie:default',
        isLocked: true,
      },
    });

    expect(screen.getByRole('button').textContent ?? '').toContain('default');
  });

  it('treats a D2-mapped <provider>:default selection as resolved while other providers still load', () => {
    // The exact pseudo-row is absent from the catalog, so the id-match scan
    // fails — but the D2 mapping resolves the label, so no pulsing skeleton
    // even while the model catalogs are still loading.
    isLoadingModels$.set(true);
    availableModels$.set([{ value: 'auggie:butler', label: 'Auggie Butler' }]);

    render(ModelPicker, {
      props: {
        selectedModel: 'auggie:default',
        isLocked: true,
      },
    });

    const button = screen.getByRole('button');
    expect(button.querySelector('.animate-pulse')).toBeNull();
    expect(button.textContent ?? '').toContain('Auggie Butler');
  });

  it('maps a <provider>:default daemon preview (defaultModelId) to its D2 row label', () => {
    availableModels$.set([
      { value: 'auggie:butler', label: 'Auggie Butler' },
      { value: 'auggie:sonnet-4.6', label: 'Sonnet 4.6', isDefault: true },
    ]);

    render(ModelPicker, {
      props: {
        selectedModel: undefined,
        defaultModelId: 'auggie:default',
        defaultModelLabel: 'Provider default',
        isLocked: true,
      },
    });

    const text = screen.getByRole('button').textContent ?? '';
    expect(text).toContain('Sonnet 4.6');
    expect(text).not.toContain('Provider default');
    expect(text).not.toContain('default');
  });

  it('falls back to the first known model row for a <provider>:default daemon preview with no isDefault row (D2)', () => {
    availableModels$.set([{ value: 'auggie:butler', label: 'Auggie Butler' }]);

    render(ModelPicker, {
      props: {
        selectedModel: undefined,
        defaultModelId: 'auggie:default',
        defaultModelLabel: 'Provider default',
        isLocked: true,
      },
    });

    const text = screen.getByRole('button').textContent ?? '';
    expect(text).toContain('Auggie Butler');
    expect(text).not.toContain('default');
  });
});
