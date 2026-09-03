import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { derived, get, readable, writable } from 'svelte/store';

const mockModelState = vi.hoisted(() => ({
  selectedModel: 'gpt5.4',
  availableModels: [{ value: 'gpt5.4', label: 'GPT 5.4', description: 'Smart model' }],
  // Provenance of the global catalog (model.availableModelsProviderId).
  // Defaults to the active provider used by most tests.
  availableModelsProviderId: 'auggie',
  loadError: null as string | null,
}));

// Seedable session-lifetime provider-models cache (providerModels slice state)
// exposed through the store mock, for the cache-hydration tests. Empty by
// default so every existing test keeps the uncached first-boot path.
const mockProviderModelsState = vi.hoisted(() => ({
  byProviderId: {} as Record<
    string,
    {
      models: { value: string; label: string; description?: string; isLegacyModel?: boolean }[];
      fetchedAt: string;
      warning?: string;
      stale?: boolean;
    }
  >,
  clearEpoch: 0,
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faCheck: { iconName: 'check' },
  faChevronDown: { iconName: 'chevron-down' },
  faChevronRight: { iconName: 'chevron-right' },
  faCircleNotch: { iconName: 'circle-notch' },
  faLock: { iconName: 'lock' },
  faPlus: { iconName: 'plus' },
  faRotateRight: { iconName: 'rotate-right' },
  faArrowsRotate: { iconName: 'arrows-rotate' },
  faExclamationTriangle: { iconName: 'exclamation-triangle' },
  faTriangleExclamation: { iconName: 'triangle-exclamation' },
  faSettings: { iconName: 'gear' },
}));

vi.mock('$lib/components/ui/button/button.svelte', async () => {
  const Button = (await import('../../ui/__tests__/mocks/button.svelte')).default;
  return { default: Button };
});

vi.mock('$features/agent/agent.client', () => ({
  agentClient: {
    setModel: vi.fn(() => Promise.resolve({ ok: true, data: { success: true } })),
  },
}));

vi.mock('$features/agent/browser', () => ({}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  // Seed a hydrated §5.38 catalog so the real provider-catalog selectors
  // (display names, id normalization, compound-id parsing) resolve.
  const { initialState, providerCatalogLoaded, providerCatalogReducer } =
    await import('$store/renderer/slices/provider-catalog/provider-catalog-slice');
  const { MOCK_PROVIDER_CATALOG } =
    await import('../../../../test/fixtures/provider-catalog.fixture');
  const providerCatalog = providerCatalogReducer(
    initialState,
    providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
  );

  return createAppStoreMockModule({
    state: () => ({
      providerCatalog,
      // The effective default provider is settings-derived (never the first
      // catalog row) — mirror the mocked selectActiveProviderId default.
      providerSettings: { enabledProviders: {} },
      model: { defaultProviderId: 'auggie' },
      providerModels: {
        byProviderId: mockProviderModelsState.byProviderId,
        clearEpoch: mockProviderModelsState.clearEpoch,
      },
    }),
    dispatch: mockSvelteDispatch,
  });
});

const providerWarnings$ = writable<Record<string, string>>({});
const providerStaleFlags$ = writable<Record<string, boolean>>({});
const reasoningEffort$ = writable<string | null | undefined>(undefined);
const agentModelEffortLevels$ = writable<string[] | undefined>(undefined);
const applyReasoningEffortMock = vi.hoisted(() => vi.fn(async () => true));
const reconcileAgentReasoningEffortMock = vi.hoisted(() => vi.fn(async () => true));
const mockSvelteDispatch = vi.hoisted(() =>
  vi.fn((action: { type?: string; payload?: unknown }) => {
    if (action.type === 'model/setLoadingStateForProvider' && Array.isArray(action.payload)) {
      const [payload] = action.payload as [
        { providerId: string; status: string; warning?: string; stale?: boolean } & Record<
          string,
          unknown
        >,
      ];
      providerWarnings$.update((warnings) => {
        const { [payload.providerId]: _cleared, ...remaining } = warnings;
        if (payload.status === 'success' && payload.warning) {
          return { ...remaining, [payload.providerId]: payload.warning };
        }
        return remaining;
      });
      providerStaleFlags$.update((flags) => {
        const { [payload.providerId]: _cleared, ...remaining } = flags;
        if (payload.status === 'success' && payload.stale) {
          return { ...remaining, [payload.providerId]: true };
        }
        return remaining;
      });
    }
    return action;
  }),
);

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', async () => {
  const { readable } = await import('svelte/store');
  const selectAgentSession = vi.fn(() => readable(undefined));
  selectAgentSession.select = vi.fn(() => undefined);
  return { selectAgentSession };
});

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => {
  const selectAgentSession = vi.fn(() => mockAgentSession$);
  selectAgentSession.select = vi.fn(() => undefined);
  const selectAgentReasoningEffort = vi.fn(() => reasoningEffort$);
  selectAgentReasoningEffort.select = vi.fn(() => get(reasoningEffort$));
  return { selectAgentSession, selectAgentReasoningEffort };
});

vi.mock('$features/agent/reasoning-effort', () => ({
  applyReasoningEffort: applyReasoningEffortMock,
  reconcileAgentReasoningEffort: reconcileAgentReasoningEffortMock,
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-slice', () => ({
  updateSession: (agentId: string, fields: Record<string, unknown>) => ({
    type: 'agentSession/updateSession',
    payload: { agentId, fields },
  }),
}));

vi.mock('$store/renderer/slices/model/model-utils', () => ({
  getModelsForProvider: vi.fn(() =>
    Promise.resolve([{ value: 'model-1', label: 'Model 1', description: 'A model' }]),
  ),
  getModelsForProviderForLoadingState: vi.fn(),
}));

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectSelectedModel: () => readable(mockModelState.selectedModel),
  selectAvailableModels: () => readable(mockModelState.availableModels),
  selectAvailableModelsProviderId: () => readable(mockModelState.availableModelsProviderId),
  selectModelFallbackInfo: () => readable(null),
  selectModelPickerCollapsedGroups: () => readable([]),
  selectIsLoadingModels: () => readable(false),
  selectLoadError: () => readable(mockModelState.loadError),
  selectAllProviderWarnings: () => providerWarnings$,
  selectAllProviderStaleFlags: () => providerStaleFlags$,
  selectAgentModelEffortLevels: () => agentModelEffortLevels$,
}));

const hasCheckedOnce$ = writable(true);
vi.mock('$store/renderer/slices/agent-availability/agent-availability-selectors', () => ({
  selectHasCheckedOnce: () => hasCheckedOnce$,
}));

// Daemon connection health ('healthy' | 'degraded' | 'down'); the D1(B)
// no-provider surface is suppressed while the daemon is down.
const daemonHealth$ = writable<'healthy' | 'degraded' | 'down'>('healthy');
vi.mock('$store/renderer/slices/daemon-health/daemon-health-selectors', () => ({
  selectDaemonHealth: () => daemonHealth$,
}));

const enabledProviderIds$ = writable(['auggie']);
const activeProviderId$ = writable('auggie');
// Mirrors `enabledProviderIds$` by default (available === enabled), so every
// existing test that only manipulates `enabledProviderIds$` keeps working
// unchanged. Tests exercising availability gating set this override to a
// distinct list (or `[]`) to diverge available from enabled.
const availableProviderOverride$ = writable<string[] | null>(null);
const availableEnabledProviderIds$ = derived(
  [enabledProviderIds$, availableProviderOverride$],
  ([enabled, override]) => override ?? enabled,
);
const mockAgentSession$ = writable<
  { id: string; workspaceId: string; provider?: string } | undefined
>(undefined);
vi.mock('$store/renderer/slices/provider-settings/provider-settings-selectors', () => ({
  selectActiveProviderId: () => activeProviderId$,
  selectModelFetchProviderIds: () =>
    derived(
      [hasCheckedOnce$, enabledProviderIds$, availableEnabledProviderIds$],
      ([checked, enabled, available]) => (checked ? available : enabled),
    ),
  selectIsProviderModelAccessAllowed: () => readable(true),
  selectAvailableEnabledProviderIds: () => availableEnabledProviderIds$,
}));

vi.mock('$shared/types/agent-session', () => ({
  getAgentProvider: vi.fn((session?: { provider?: string }) => session?.provider),
  isPendingAgentSession: vi.fn(
    (session: { isPending?: boolean; status?: string }) =>
      session?.isPending === true || session?.status === 'pending',
  ),
}));

vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToSettings: vi.fn(),
}));

vi.mock('svelte-sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import {
  getModelsForProvider,
  getModelsForProviderForLoadingState,
} from '$store/renderer/slices/model/model-utils';
import { selectModel } from '$store/renderer/slices/model/model-slice';
import { store as mockAppStore } from '$store/renderer/store';
import ModelPicker from './ModelPicker.svelte';
import { warmImport } from '../../../../test/warm-import';

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../ui/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../../ui/__tests__/mocks/button.svelte'));

afterEach(() => {
  availableProviderOverride$.set(null);
  mockModelState.availableModelsProviderId = 'auggie';
  daemonHealth$.set('healthy');
  providerStaleFlags$.set({});
  mockProviderModelsState.byProviderId = {};
  mockProviderModelsState.clearEpoch = 0;
  reasoningEffort$.set(undefined);
  agentModelEffortLevels$.set(undefined);
});

describe('ModelPicker locked state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelState.selectedModel = 'gpt5.4';
    mockModelState.loadError = null;
    mockModelState.availableModels = [
      {
        value: 'gpt5.4',
        label: 'GPT 5.4',
        description: 'Smart model',
      },
    ];
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

  it('renders the provider icon in locked state', () => {
    render(ModelPicker, {
      props: {
        selectedModel: 'gpt5.4',
        providerId: 'auggie',
        isLocked: true,
      },
    });

    const button = screen.getByRole('button');
    // ProviderIcon renders an outer <span> with class "inline-flex"
    const providerIcon = button.querySelector('span.inline-flex');
    expect(providerIcon).not.toBeNull();
  });

  it('renders the provider icon when locked with showLockIconWhenLocked=false', () => {
    render(ModelPicker, {
      props: {
        selectedModel: 'gpt5.4',
        providerId: 'auggie',
        isLocked: true,
        showLockIconWhenLocked: false,
      },
    });

    const button = screen.getByRole('button');
    // ProviderIcon renders an outer <span> with class "inline-flex"
    const providerIcon = button.querySelector('span.inline-flex');
    expect(providerIcon).not.toBeNull();
    // Lock icon should NOT be present
    expect(button.querySelector('[data-icon="lock"]')).toBeNull();
  });

  it('uses the selectedModel prop on the first render', () => {
    mockModelState.selectedModel = 'gpt5.4';
    mockModelState.availableModels = [
      { value: 'gpt5.4', label: 'GPT 5.4', description: 'Smart model' },
      { value: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5', description: 'Fast model' },
    ];

    render(ModelPicker, {
      props: {
        selectedModel: 'claude-sonnet-4.5',
        providerId: 'auggie',
        isLocked: true,
      },
    });

    expect(screen.getByRole('button').textContent).toContain('Claude Sonnet 4.5');
  });
});

describe('ModelPicker legacy Auggie models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelState.selectedModel = 'current';
    mockModelState.availableModels = [{ value: 'current', label: 'Current model' }];
    mockModelState.availableModelsProviderId = 'auggie';
    mockModelState.loadError = null;
    enabledProviderIds$.set(['auggie']);
    activeProviderId$.set('auggie');
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({
      models: [
        { value: 'current', label: 'Current model' },
        { value: 'legacy-opus', label: 'Opus 4.1', isLegacyModel: true },
      ],
    });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('keeps current models visible and toggles the collapsed legacy subgroup', async () => {
    const onModelChange = vi.fn();
    render(ModelPicker, {
      props: { selectedModel: 'current', onModelChange, portal: false },
    });

    await fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('option', { name: /Current model/ })).toBeTruthy();
    const legacyToggle = await screen.findByRole('button', { name: 'Toggle legacy models' });
    expect(legacyToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('option', { name: /Opus 4.1/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Refresh Legacy models/ })).toBeNull();

    await fireEvent.click(legacyToggle);
    expect(legacyToggle.getAttribute('aria-expanded')).toBe('true');
    const legacyOption = await screen.findByRole('option', { name: /Opus 4.1/ });
    await fireEvent.click(legacyOption);
    expect(onModelChange).toHaveBeenCalledWith('legacy-opus', {
      providerId: 'auggie',
      modelId: 'legacy-opus',
    });
  });

  it('supports keyboard expand and collapse on the legacy subgroup header', async () => {
    render(ModelPicker, { props: { selectedModel: 'current', portal: false } });

    await fireEvent.click(screen.getByRole('button'));
    const legacyToggle = await screen.findByRole('button', { name: 'Toggle legacy models' });
    await fireEvent.keyDown(legacyToggle, { key: 'Enter' });
    await waitFor(() => expect(legacyToggle.getAttribute('aria-expanded')).toBe('true'));
    expect(await screen.findByRole('option', { name: /Opus 4.1/ })).toBeTruthy();

    await fireEvent.keyDown(legacyToggle, { key: ' ' });
    await waitFor(() => expect(legacyToggle.getAttribute('aria-expanded')).toBe('false'));
    expect(screen.queryByRole('option', { name: /Opus 4.1/ })).toBeNull();
  });

  it('reveals matching legacy models during search and restores collapse when cleared', async () => {
    render(ModelPicker, { props: { selectedModel: 'current', portal: false } });

    await fireEvent.click(screen.getByRole('button'));
    const legacyToggle = await screen.findByRole('button', { name: 'Toggle legacy models' });
    const search = screen.getByRole('searchbox', { name: 'Search options' });
    expect(screen.queryByRole('option', { name: /Opus 4.1/ })).toBeNull();

    await fireEvent.input(search, { target: { value: 'Legacy' } });
    expect(await screen.findByRole('option', { name: /Opus 4.1/ })).toBeTruthy();
    expect(legacyToggle.getAttribute('aria-expanded')).toBe('true');
    expect(legacyToggle.getAttribute('aria-disabled')).toBe('true');
    expect(legacyToggle.hasAttribute('disabled')).toBe(false);
    await fireEvent.click(legacyToggle);

    await fireEvent.input(search, { target: { value: '' } });
    await waitFor(() => expect(screen.queryByRole('option', { name: /Opus 4.1/ })).toBeNull());
    expect(legacyToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('option', { name: /Current model/ })).toBeTruthy();
  });

  it('shows the legacy subgroup when every Auggie model is legacy', async () => {
    mockModelState.selectedModel = 'legacy-opus';
    mockModelState.availableModels = [];
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({
      models: [{ value: 'legacy-opus', label: 'Opus 4.1', isLegacyModel: true }],
    });
    render(ModelPicker, { props: { selectedModel: 'legacy-opus', portal: false } });

    await fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('option', { name: /Opus 4.1/ })).toBeTruthy();
    const legacyToggle = screen.getByRole('button', { name: 'Toggle legacy models' });
    expect(legacyToggle.getAttribute('aria-expanded')).toBe('true');
    expect(legacyToggle.getAttribute('aria-disabled')).toBe('true');
    expect(legacyToggle.hasAttribute('disabled')).toBe(false);
  });

  it('restores an expanded subgroup after search clears', async () => {
    render(ModelPicker, { props: { selectedModel: 'current', portal: false } });

    await fireEvent.click(screen.getByRole('button'));
    const legacyToggle = await screen.findByRole('button', { name: 'Toggle legacy models' });
    const search = screen.getByRole('searchbox', { name: 'Search options' });
    await fireEvent.click(legacyToggle);
    expect(legacyToggle.getAttribute('aria-expanded')).toBe('true');

    await fireEvent.input(search, { target: { value: 'Opus' } });
    expect(legacyToggle.getAttribute('aria-disabled')).toBe('true');
    expect(legacyToggle.hasAttribute('disabled')).toBe(false);
    await fireEvent.input(search, { target: { value: '' } });

    expect(legacyToggle.getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByRole('option', { name: /Opus 4.1/ })).toBeTruthy();
  });
});

describe('ModelPicker default pseudo-row filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelState.selectedModel = 'auggie:sonnet';
    mockModelState.availableModels = [];
    mockModelState.availableModelsProviderId = 'auggie';
    mockModelState.loadError = null;
    enabledProviderIds$.set(['auggie']);
    activeProviderId$.set('auggie');
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('never lists a default pseudo-row still served by an older daemon', async () => {
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({
      models: [
        { value: 'auggie:default', label: 'Default (recommended)' },
        { value: 'auggie:sonnet', label: 'Sonnet 4.6' },
        { value: 'auggie:opus', label: 'Opus 4.5' },
      ],
    });
    render(ModelPicker, { props: { selectedModel: 'auggie:sonnet', portal: false } });

    await fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('option', { name: /Sonnet 4.6/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Opus 4.5/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Default \(recommended\)/ })).toBeNull();
  });

  it('cannot surface the default pseudo-row through search', async () => {
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({
      models: [
        { value: 'auggie:default', label: 'Default (recommended)' },
        { value: 'auggie:sonnet', label: 'Sonnet 4.6' },
      ],
    });
    render(ModelPicker, { props: { selectedModel: 'auggie:sonnet', portal: false } });

    await fireEvent.click(screen.getByRole('button'));
    await screen.findByRole('option', { name: /Sonnet 4.6/ });
    const search = screen.getByRole('searchbox', { name: 'Search options' });
    await fireEvent.input(search, { target: { value: 'Default' } });

    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /Default \(recommended\)/ })).toBeNull(),
    );
  });

  it('keeps the default pseudo-row when it is the only row for the provider (D1)', async () => {
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({
      models: [{ value: 'auggie:default', label: 'Default (recommended)' }],
    });
    render(ModelPicker, { props: { selectedModel: 'auggie:default', portal: false } });

    await fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('option', { name: /Default \(recommended\)/ })).toBeTruthy();
  });
});

describe('ModelPicker combined reasoning mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelState.selectedModel = 'codex:gpt-5.6-sol';
    mockModelState.loadError = null;
    mockModelState.availableModels = [
      {
        value: 'codex:gpt-5.6-sol',
        label: 'GPT-5.6-Sol',
        description: 'Codex model',
        effortLevels: ['low', 'medium', 'high', 'max'],
      },
    ];
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({
      models: [
        {
          value: 'codex:gpt-5.6-sol',
          label: 'GPT-5.6-Sol',
          description: 'Codex model',
          effortLevels: ['low', 'medium', 'high', 'max'],
        },
      ],
    });
    enabledProviderIds$.set(['codex']);
    activeProviderId$.set('codex');
    reasoningEffort$.set('medium');
    agentModelEffortLevels$.set(undefined);
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    enabledProviderIds$.set(['auggie']);
    activeProviderId$.set('auggie');
  });

  const effortTrigger = () => screen.getByTestId('effort-picker-trigger');

  async function openEffortSelect() {
    await fireEvent.click(effortTrigger());
    const listboxes = await screen.findAllByRole('listbox');
    return listboxes[listboxes.length - 1];
  }

  async function selectEffort(listbox: HTMLElement, name: string) {
    await fireEvent.pointerUp(within(listbox).getByRole('option', { name }), {
      pointerType: 'mouse',
    });
  }

  const triggerBranches: Array<{
    name: string;
    props: { size?: 'xs'; isLocked?: boolean };
  }> = [
    { name: 'regular', props: {} },
    { name: 'xs', props: { size: 'xs' } },
    { name: 'locked', props: { isLocked: true } },
  ];

  it.each(triggerBranches)(
    'renders Auto, Off, and explicit effort gauges in the $name trigger',
    async ({ props }) => {
      const levels = ['none', 'low', 'medium', 'high'];
      const cases: Array<{
        effort: string | null;
        label: string;
        gaugeValue: number | null;
      }> = [
        { effort: null, label: 'Auto', gaugeValue: null },
        { effort: 'none', label: 'Off', gaugeValue: null },
        { effort: 'low', label: 'Low', gaugeValue: 1 },
        { effort: 'medium', label: 'Medium', gaugeValue: 2 },
        { effort: 'high', label: 'High', gaugeValue: 3 },
      ];

      for (const { effort, label, gaugeValue } of cases) {
        reasoningEffort$.set(effort);
        agentModelEffortLevels$.set(levels);
        render(ModelPicker, {
          props: {
            selectedModel: 'codex:gpt-5.6-sol',
            agentId: 'agent-1',
            workspaceId: 'ws-1',
            showReasoning: true,
            portal: false,
            ...props,
          },
        });

        const accessibleLabel = `GPT-5.6-Sol · ${label}`;
        const trigger = await waitFor(() => screen.getByRole('button', { name: accessibleLabel }));
        const titleElement = props.isLocked ? trigger : trigger.querySelector('[title]');
        expect(titleElement?.getAttribute('title')).toContain(accessibleLabel);

        const gauge = screen.queryByTestId('model-reasoning-effort-gauge');
        if (gaugeValue === null) {
          expect(gauge).toBeNull();
        } else {
          expect(gauge?.dataset.gaugeValue).toBe(String(gaugeValue));
          expect(gauge?.dataset.gaugeSize).toBe('compact');
        }

        if (effort === null) {
          expect(screen.getByTestId('model-reasoning-strength').textContent).toContain('Auto');
        } else {
          expect(screen.queryByTestId('model-reasoning-strength')).toBeNull();
          expect(trigger.textContent).not.toContain(label);
        }

        cleanup();
        document.body.innerHTML = '';
      }
    },
  );

  it('hides the reasoning footer when the selected model has no effort levels', async () => {
    const models = [{ value: 'no-effort', label: 'No effort model' }];
    mockModelState.availableModels = models;
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({ models });

    render(ModelPicker, {
      props: {
        selectedModel: 'no-effort',
        portal: false,
        showReasoning: true,
      },
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(screen.queryByTestId('model-reasoning-section')).toBeNull();
  });

  it('shows a compact reasoning select and replaces the current strength with a gauge', async () => {
    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5.6-sol',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        showReasoning: true,
        portal: false,
      },
    });

    const trigger = screen.getByRole('button');
    expect(trigger.textContent).toContain('GPT-5.6-Sol');
    await waitFor(() => expect(screen.getByLabelText('GPT-5.6-Sol · Medium')).toBeTruthy());
    expect(trigger.textContent).not.toContain('Medium');
    expect(screen.getByTestId('model-reasoning-effort-gauge').dataset.gaugeValue).toBe('1');
    expect(screen.queryByTestId('effort-gauge')).toBeNull();

    await fireEvent.click(trigger);

    const popover = screen.getByRole('listbox');
    expect(popover.className).toContain('bg-background!');
    expect(popover.className).toContain('[&_[role=searchbox]]:border-b!');
    expect(popover.className).toContain('[&_[role=searchbox]]:border-solid!');
    const modelOption = await screen.findByRole('option', { name: /GPT-5\.6-Sol/ });
    expect(modelOption.textContent).toContain('Codex model');
    expect(modelOption.textContent).not.toContain('Effort:');
    expect(modelOption.textContent).not.toContain('low · medium · high · max');
    expect(screen.getByTestId('model-reasoning-section')).toBeTruthy();
    const selectTrigger = effortTrigger() as HTMLButtonElement;
    expect(selectTrigger.disabled).toBe(false);
    expect(selectTrigger.textContent?.trim()).toBe('Medium');
    expect(selectTrigger.className).toContain('text-xs');
    expect(selectTrigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('effort-gauge')).toBeTruthy();
    expect(screen.queryByRole('slider')).toBeNull();

    const effortListbox = await openEffortSelect();
    expect(within(effortListbox).getAllByRole('option')).toHaveLength(5);
    expect(within(effortListbox).getByRole('option', { name: 'Auto' })).toBeTruthy();
    expect(screen.queryByTestId('effort-slider-tick')).toBeNull();
    expect(applyReasoningEffortMock).not.toHaveBeenCalled();
  });

  it('renders expanded Codex effort rows as one base model option', async () => {
    const expandedModels = [
      {
        value: 'codex:gpt-5.6-sol[low]',
        label: 'GPT-5.6-Sol',
        description: 'Low reasoning effort',
        effortLevels: ['low'],
      },
      {
        value: 'codex:gpt-5.6-sol[medium]',
        label: 'GPT-5.6-Sol',
        description: 'Balanced Codex model',
        effortLevels: ['medium'],
      },
      {
        value: 'codex:gpt-5.6-sol[ultra]',
        label: 'GPT-5.6-Sol (ultra)',
        description: 'Ultra reasoning effort',
        effortLevels: ['ultra'],
      },
    ];
    mockModelState.availableModels = expandedModels;
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({ models: expandedModels });

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5.6-sol',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        showReasoning: true,
        portal: false,
      },
    });

    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('codex');
    });
    await fireEvent.click(screen.getByRole('button'));

    expect(await screen.findAllByRole('option', { name: /GPT-5\.6-Sol/ })).toHaveLength(1);
    expect((effortTrigger() as HTMLButtonElement).disabled).toBe(false);
  });

  it('uses applyReasoningEffort when a reasoning level is selected', async () => {
    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5.6-sol',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        showReasoning: true,
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect((effortTrigger() as HTMLButtonElement).disabled).toBe(false));
    const effortListbox = await openEffortSelect();
    await selectEffort(effortListbox, 'High');

    await waitFor(() => {
      expect(applyReasoningEffortMock).toHaveBeenCalledWith('agent-1', 'ws-1', 'high', 'medium');
    });
  });

  it('uses controlled reasoning without requiring an agent session', async () => {
    const onReasoningChange = vi.fn(async () => true);

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5.6-sol',
        showReasoning: true,
        reasoningEffort: 'high',
        onReasoningChange,
        portal: false,
      },
    });

    const trigger = screen.getByRole('button');
    await waitFor(() => expect(screen.getByLabelText('GPT-5.6-Sol · High')).toBeTruthy());
    expect(trigger.textContent).not.toContain('High');
    expect(screen.getByTestId('model-reasoning-effort-gauge').dataset.gaugeValue).toBe('2');
    expect(screen.queryByTestId('effort-gauge')).toBeNull();

    await fireEvent.click(trigger);
    expect((effortTrigger() as HTMLButtonElement).disabled).toBe(false);
    const effortListbox = await openEffortSelect();
    await selectEffort(effortListbox, 'Max');

    await waitFor(() => expect(onReasoningChange).toHaveBeenCalledWith('max'));
    expect(applyReasoningEffortMock).not.toHaveBeenCalled();
  });

  it('displays an unsupported controlled effort as Auto without mutating it', async () => {
    const onReasoningChange = vi.fn();
    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5.6-sol',
        showReasoning: true,
        reasoningEffort: 'xhigh',
        onReasoningChange,
        portal: false,
      },
    });

    const trigger = screen.getByRole('button');
    await waitFor(() => expect(trigger.textContent).toContain('Auto'));

    await fireEvent.click(trigger);
    await waitFor(() => expect((effortTrigger() as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByTestId('effort-gauge')).toBeNull();
    expect(trigger.textContent).toContain('Auto');
    expect(trigger.textContent).not.toContain('Default');
    expect(effortTrigger().textContent?.trim()).toBe('Auto');
    const effortListbox = await openEffortSelect();
    expect(within(effortListbox).getByRole('option', { name: 'Auto' })).toBeTruthy();
    expect(onReasoningChange).not.toHaveBeenCalled();
  });

  it('lets the canonical select own keyboard navigation, focus, and Escape', async () => {
    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5.6-sol',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        showReasoning: true,
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));
    const selectTrigger = (await screen.findByTestId('effort-picker-trigger')) as HTMLButtonElement;
    await waitFor(() => expect(selectTrigger.disabled).toBe(false));
    selectTrigger.focus();
    await fireEvent.keyDown(selectTrigger, { key: 'Enter' });
    const listboxes = screen.getAllByRole('listbox');
    expect(listboxes).toHaveLength(2);

    await fireEvent.keyDown(selectTrigger, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.getAllByRole('listbox')).toHaveLength(1);
      expect(selectTrigger.getAttribute('aria-expanded')).toBe('false');
    });
    expect(document.activeElement).toBe(selectTrigger);

    await fireEvent.keyDown(selectTrigger, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('closes the open menu when the trigger is clicked again', async () => {
    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5.6-sol',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        showReasoning: true,
        portal: false,
      },
    });

    const trigger = screen.getByRole('button');
    await fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeTruthy();

    await fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('filters by provider tabs and supports arrow-key navigation', async () => {
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => ({
      models:
        providerId === 'codex'
          ? [{ value: 'codex:gpt-5.6-sol', label: 'GPT-5.6-Sol', description: 'Codex model' }]
          : [{ value: 'gpt5.4', label: 'GPT 5.4', description: 'Auggie model' }],
    }));
    enabledProviderIds$.set(['auggie', 'codex']);

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5.6-sol',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        showReasoning: true,
        portal: false,
      },
    });

    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('auggie');
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('codex');
    });
    await fireEvent.click(screen.getByRole('button'));

    const codexTab = screen.getByRole('tab', { name: /Codex/ });
    const providerTabs = screen.getByTestId('model-provider-tabs');
    expect(providerTabs.parentElement?.className).toContain('bg-popover!');
    expect(providerTabs.parentElement?.className).toContain('border-b!');
    expect(codexTab.getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByRole('option', { name: /GPT-5\.6-Sol/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /GPT 5\.4/ })).toBeNull();

    await fireEvent.keyDown(codexTab, { key: 'ArrowLeft' });

    const auggieTab = screen.getByRole('tab', { name: /Auggie/ });
    expect(auggieTab.getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByRole('option', { name: /GPT 5\.4/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /GPT-5\.6-Sol/ })).toBeNull();
  });

  it('opens provider settings from the control after the provider tabs', async () => {
    const { navigateToSettings } = await import('$lib/utils/workspace-navigation');
    vi.mocked(navigateToSettings).mockResolvedValue(undefined);
    enabledProviderIds$.set(['auggie', 'codex']);

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5.6-sol',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        showReasoning: true,
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));
    const settingsButton = screen.getByTestId('model-provider-settings-button');
    expect(settingsButton).toBeTruthy();

    await fireEvent.click(settingsButton);

    expect(vi.mocked(navigateToSettings)).toHaveBeenCalledWith({
      tab: 'accounts',
      hash: 'providers',
    });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('force-refreshes and replaces the active provider list from the tab row', async () => {
    let resolveRefresh!: (result: {
      models: { value: string; label: string; description: string }[];
    }) => void;
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(
      async (providerId, options) => {
        if (providerId === 'codex' && options?.forceRefresh) {
          return new Promise((resolve) => {
            resolveRefresh = resolve;
          });
        }
        return {
          models:
            providerId === 'codex'
              ? [{ value: 'codex:gpt-5.6-sol', label: 'GPT-5.6-Sol', description: 'Codex model' }]
              : [{ value: 'gpt5.4', label: 'GPT 5.4', description: 'Auggie model' }],
        };
      },
    );
    enabledProviderIds$.set(['auggie', 'codex']);

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5.6-sol',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        showReasoning: true,
        portal: false,
      },
    });

    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('codex');
    });
    await fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('option', { name: /GPT-5\.6-Sol/ })).toBeTruthy();

    const refreshButton = screen.getByTestId('model-provider-refresh-button');
    expect(refreshButton.getAttribute('title')).toBe('Refresh OpenAI Codex models');
    vi.mocked(getModelsForProviderForLoadingState).mockClear();
    await fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('codex', {
        forceRefresh: true,
      });
    });
    expect(refreshButton.hasAttribute('disabled')).toBe(true);
    expect(refreshButton.querySelector('.animate-spin')).toBeTruthy();

    resolveRefresh({
      models: [{ value: 'codex:gpt-6-codex', label: 'GPT-6 Codex', description: 'Smarter' }],
    });

    expect(await screen.findByRole('option', { name: /GPT-6 Codex/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /GPT-5\.6-Sol/ })).toBeNull();
    await waitFor(() => expect(refreshButton.hasAttribute('disabled')).toBe(false));
  });

  it('keeps a force-refreshed provider ahead of overlapping catalog fetches', async () => {
    mockProviderModelsState.byProviderId = {
      codex: {
        models: [{ value: 'codex:gpt-5.6-sol', label: 'GPT-5.6-Sol', description: 'Cached model' }],
        fetchedAt: new Date().toISOString(),
      },
    };
    let resolveCatalog!: (result: {
      models: { value: string; label: string; description: string }[];
    }) => void;
    let resolveRefresh!: (result: {
      models: { value: string; label: string; description: string }[];
    }) => void;
    const catalogResult = new Promise<{
      models: { value: string; label: string; description: string }[];
    }>((resolve) => {
      resolveCatalog = resolve;
    });
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(
      async (providerId, options) => {
        if (providerId === 'codex') {
          if (options?.forceRefresh) {
            return new Promise((resolve) => {
              resolveRefresh = resolve;
            });
          }
          return catalogResult;
        }
        return { models: [] };
      },
    );
    enabledProviderIds$.set(['auggie', 'codex']);

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5.6-sol',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        showReasoning: true,
        portal: false,
      },
    });

    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('codex');
    });
    await fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('option', { name: /GPT-5\.6-Sol/ })).toBeTruthy();

    await fireEvent.click(screen.getByTestId('model-provider-refresh-button'));
    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('codex', {
        forceRefresh: true,
      });
    });

    enabledProviderIds$.set(['auggie', 'codex', 'claude-code']);
    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('claude-code');
    });
    expect(
      vi
        .mocked(getModelsForProviderForLoadingState)
        .mock.calls.filter(
          ([providerId, options]) => providerId === 'codex' && !options?.forceRefresh,
        ),
    ).toHaveLength(1);

    resolveRefresh({
      models: [{ value: 'codex:gpt-6-codex', label: 'GPT-6 Codex', description: 'Forced' }],
    });
    expect(await screen.findByRole('option', { name: /GPT-6 Codex/ })).toBeTruthy();

    resolveCatalog({
      models: [{ value: 'codex:catalog-model', label: 'Catalog Refetch', description: 'Stale' }],
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByRole('option', { name: /GPT-6 Codex/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Catalog Refetch/ })).toBeNull();
    const codexCacheWrites = mockSvelteDispatch.mock.calls.filter(
      ([action]) =>
        action?.type === 'providerModels/providerModelsLoaded' &&
        (action.payload as [string, unknown])[0] === 'codex',
    );
    expect(codexCacheWrites).toHaveLength(1);
    expect(
      (codexCacheWrites[0][0].payload as [string, { models: { value: string }[] }])[1].models,
    ).toEqual([{ value: 'codex:gpt-6-codex', label: 'GPT-6 Codex', description: 'Forced' }]);
  });

  it('uses session effort levels when the selected catalog model has no levels', async () => {
    agentModelEffortLevels$.set(['low', 'medium', 'high']);
    mockModelState.availableModels = [
      { value: 'codex:gpt-5.6-sol', label: 'GPT-5.6-Sol', description: 'Codex model' },
    ];
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({
      models: [{ value: 'codex:gpt-5.6-sol', label: 'GPT-5.6-Sol', description: 'Codex model' }],
    });

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5.6-sol',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        showReasoning: true,
        portal: false,
      },
    });

    const trigger = screen.getByRole('button');
    expect(trigger.textContent).toContain('GPT-5.6-Sol');
    expect(trigger.textContent).not.toContain('Medium');
    expect(screen.getByTestId('model-reasoning-effort-gauge').dataset.gaugeValue).toBe('1');

    await fireEvent.click(trigger);
    expect(screen.getByTestId('model-reasoning-section')).toBeTruthy();
    const selectTrigger = effortTrigger() as HTMLButtonElement;
    expect(selectTrigger.disabled).toBe(false);
    expect(selectTrigger.getAttribute('aria-expanded')).toBe('false');

    const effortListbox = await openEffortSelect();
    expect(within(effortListbox).getAllByRole('option')).toHaveLength(4);
  });

  it('shows Auto for the provider-default state without guessing a concrete strength', async () => {
    reasoningEffort$.set(null);

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5.6-sol',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        showReasoning: true,
        portal: false,
      },
    });

    const trigger = screen.getByRole('button');
    expect(trigger.textContent).toContain('GPT-5.6-Sol');
    await waitFor(() => expect(trigger.textContent).toContain('Auto'));
    expect(screen.getByLabelText('GPT-5.6-Sol · Auto')).toBeTruthy();
    expect(trigger.textContent).not.toContain('Default');
    expect(screen.queryByTestId('effort-gauge')).toBeNull();

    await fireEvent.click(trigger);
    const selectTrigger = effortTrigger() as HTMLButtonElement;
    await waitFor(() => expect(selectTrigger.disabled).toBe(false));
    expect(selectTrigger.textContent?.trim()).toBe('Auto');
    expect(selectTrigger.className).toContain('text-xs');
    expect(screen.queryByTestId('effort-gauge')).toBeNull();
  });

  it('shows explicit none as Off in the composer, tooltip, accessibility label, and select', async () => {
    reasoningEffort$.set('none');
    agentModelEffortLevels$.set(['none', 'low', 'ultra']);

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5.6-sol',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        showReasoning: true,
        portal: false,
      },
    });

    const trigger = screen.getByRole('button');
    const labeledTrigger = await waitFor(() => screen.getByLabelText('GPT-5.6-Sol · Off'));
    expect(labeledTrigger.getAttribute('title')).toBe('GPT-5.6-Sol · Off');
    expect(trigger.textContent).not.toContain('Off');
    expect(screen.queryByTestId('model-reasoning-strength')).toBeNull();
    expect(screen.queryByTestId('model-reasoning-effort-gauge')).toBeNull();

    await fireEvent.click(trigger);
    const selectTrigger = effortTrigger();
    expect(selectTrigger.textContent?.trim()).toBe('Off');
    expect(selectTrigger.getAttribute('aria-label')).toContain('Off');
    const gauge = screen.getByTestId('effort-gauge');
    expect(screen.getByTestId('model-reasoning-section').contains(gauge)).toBe(true);
    expect(gauge.dataset.gaugeValue).toBe('0');
    const listbox = await openEffortSelect();
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((option) => option.textContent?.replace('✓', '').trim()),
    ).toEqual(['Auto', 'Off', 'Low', 'ultra']);
    expect(applyReasoningEffortMock).not.toHaveBeenCalled();
    await selectEffort(listbox, 'Auto');
    expect(screen.queryByTestId('effort-gauge')).toBeNull();

    await waitFor(() => {
      expect(applyReasoningEffortMock).toHaveBeenCalledWith('agent-1', 'ws-1', null, 'none');
    });
  });
});

describe('ModelPicker multi-provider mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelState.selectedModel = 'gpt5.4';
    mockModelState.loadError = null;
    mockModelState.availableModels = [
      { value: 'gpt5.4', label: 'GPT 5.4', description: 'Smart model' },
    ];
    providerWarnings$.set({});
    mockSvelteDispatch.mockClear();
    vi.mocked(getModelsForProvider).mockResolvedValue([
      { value: 'model-1', label: 'Model 1', description: 'A model' },
    ]);
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => ({
      models: await vi.mocked(getModelsForProvider)(providerId),
    }));
    enabledProviderIds$.set(['auggie']);
    activeProviderId$.set('auggie');
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('fetches models for all enabled providers on mount', async () => {
    enabledProviderIds$.set(['auggie', 'claude-code']);

    render(ModelPicker, {
      props: {
        selectedModel: 'gpt5.4',
      },
    });

    // Wait for the debounced $effect (50ms) to fire the fetches.
    await waitFor(() => {
      expect(getModelsForProvider).toHaveBeenCalledWith('auggie');
      expect(getModelsForProvider).toHaveBeenCalledWith('claude-code');
    });
  });

  it('renders the active provider models while another provider is still loading', async () => {
    let resolveCodex:
      | ((result: { models: { value: string; label: string; description: string }[] }) => void)
      | undefined;
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation((providerId) => {
      if (providerId === 'auggie') {
        return Promise.resolve({
          models: [{ value: 'gpt5.4', label: 'GPT 5.4', description: 'Smart model' }],
        });
      }

      if (providerId === 'codex') {
        return new Promise((resolve) => {
          resolveCodex = resolve;
        });
      }

      return Promise.resolve({ models: [] });
    });
    enabledProviderIds$.set(['auggie', 'codex']);
    activeProviderId$.set('auggie');

    render(ModelPicker, {
      props: {
        selectedModel: 'gpt5.4',
        portal: false,
      },
    });

    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('auggie');
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('codex');
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByRole('option', { name: /GPT 5\.4/ })).toBeTruthy();
    expect(screen.getByText('Loading OpenAI Codex models…')).toBeTruthy();
    expect(screen.queryByText('No models available')).toBeNull();

    resolveCodex?.({
      models: [{ value: 'codex:gpt-5-codex', label: 'GPT-5 Codex', description: 'Smart' }],
    });

    expect(await screen.findByRole('option', { name: /GPT-5 Codex/ })).toBeTruthy();
  });

  it('passes forceRefresh: true when the per-group refresh button is clicked', async () => {
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({
      models: [{ value: 'gpt5.4', label: 'GPT 5.4', description: 'Smart model' }],
    });
    enabledProviderIds$.set(['auggie']);

    render(ModelPicker, {
      props: {
        selectedModel: 'gpt5.4',
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));
    const refreshButton = await screen.findByRole('button', {
      name: /Refresh .* models/,
    });

    vi.mocked(getModelsForProviderForLoadingState).mockClear();
    await fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('auggie', {
        forceRefresh: true,
      });
    });
  });

  it('retries once per current provider when silent fallback sees unavailable models', async () => {
    const modelsByProvider = {
      auggie: [] as { value: string; label: string; description: string }[],
      codex: [{ value: 'codex:model-1', label: 'Codex Model 1', description: 'A model' }],
    };
    vi.mocked(getModelsForProvider).mockImplementation((providerId) =>
      Promise.resolve(modelsByProvider[providerId as keyof typeof modelsByProvider] ?? []),
    );

    enabledProviderIds$.set(['auggie', 'codex']);

    const { rerender } = render(ModelPicker, {
      props: {
        selectedModel: 'auggie:missing-model',
        silentFallback: true,
      },
    });

    await waitFor(() => {
      expect(
        vi.mocked(getModelsForProvider).mock.calls.filter(([provider]) => provider === 'auggie'),
      ).toHaveLength(2);
    });
    expect(
      vi.mocked(getModelsForProvider).mock.calls.filter(([provider]) => provider === 'codex'),
    ).toHaveLength(1);

    vi.mocked(getModelsForProvider).mockClear();
    modelsByProvider.auggie = [
      { value: 'auggie:model-1', label: 'Auggie Model 1', description: 'A model' },
    ];
    modelsByProvider.codex = [];
    // Force the component to re-fetch by changing the provider list (busts the
    // dedup cache inside fetchAllProviderModels which skips when the sorted key
    // matches the previous fetch). Use an intermediate list whose debounced
    // fetch is observable — ['codex'] sorts to a key different from
    // 'auggie,codex', so the fetch actually runs — and wait for it, proving
    // the dedup key moved off 'auggie,codex' before restoring the full list.
    // A fixed sleep here races the 50ms debounce: if the intermediate timer is
    // cleared by the re-set before firing, the dedup check would skip the
    // refetch entirely and the final waitFor could never pass.
    enabledProviderIds$.set(['codex']);
    await waitFor(() => {
      expect(vi.mocked(getModelsForProvider)).toHaveBeenCalledWith('codex');
    });

    vi.mocked(getModelsForProvider).mockClear();
    enabledProviderIds$.set(['auggie', 'codex']);

    await rerender({
      selectedModel: 'codex:missing-model',
      silentFallback: true,
    });

    await waitFor(
      () => {
        expect(
          vi.mocked(getModelsForProvider).mock.calls.filter(([provider]) => provider === 'codex'),
        ).toHaveLength(2);
      },
      { timeout: 5000 },
    );
    expect(
      vi.mocked(getModelsForProvider).mock.calls.filter(([provider]) => provider === 'auggie'),
    ).toHaveLength(1);
  });

  it('keeps working provider models selectable while showing a failed provider warning', async () => {
    vi.mocked(getModelsForProvider).mockImplementation((providerId) => {
      if (providerId === 'codex') {
        return Promise.reject(new Error('Codex: CLI not found'));
      }

      return Promise.resolve([
        { value: 'sonnet4.6', label: 'Sonnet 4.6', description: 'Smart model' },
      ]);
    });
    enabledProviderIds$.set(['auggie', 'codex']);
    const onModelChange = vi.fn();

    render(ModelPicker, {
      props: {
        selectedModel: 'gpt5.4',
        onModelChange,
        portal: false,
      },
    });

    await waitFor(() => {
      expect(vi.mocked(getModelsForProvider)).toHaveBeenCalledWith('codex');
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByRole('option', { name: /Sonnet 4\.6/ })).toBeTruthy();
    expect(screen.getAllByText(/OpenAI Codex: CLI not found/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/developers\.openai\.com\/codex/).length).toBeGreaterThan(0);

    await fireEvent.click(screen.getByRole('option', { name: /Sonnet 4\.6/ }));

    expect(onModelChange).toHaveBeenCalledWith('sonnet4.6', {
      providerId: 'auggie',
      modelId: 'sonnet4.6',
    });
  });

  it('surfaces an empty-with-warning provider as a visible disabled row instead of hiding the group', async () => {
    // Client-mapped form of the PROTOCOL §5.30 degraded response
    // `{ models: [], source: 'static', warning }` — the wire request/envelope
    // for that shape is asserted in model-catalog-bridge-seeder.test.ts.
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => {
      if (providerId === 'opencode') {
        return { models: [], warning: 'opencode: opencode binary not found' };
      }
      return { models: [{ value: 'gpt5.4', label: 'GPT 5.4', description: 'Smart model' }] };
    });
    enabledProviderIds$.set(['auggie', 'opencode']);

    render(ModelPicker, {
      props: {
        selectedModel: 'gpt5.4',
        portal: false,
      },
    });

    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('opencode');
    });

    await fireEvent.click(screen.getByRole('button'));

    // Providers with models are unaffected…
    expect(await screen.findByRole('option', { name: /GPT 5\.4/ })).toBeTruthy();
    // …and the empty-with-warning provider renders a visible warning row
    // instead of the group vanishing.
    expect(screen.getAllByText(/OpenCode: opencode binary not found/).length).toBeGreaterThan(0);
  });

  it('shows an actionable Codex stale-list notice when the provider returns a fallback warning', async () => {
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => {
      if (providerId === 'codex') {
        return {
          models: [{ value: 'codex:gpt-5-codex', label: 'GPT-5 Codex', description: 'Smart' }],
          warning: 'Codex not installed; using static model list',
        };
      }

      return { models: [] };
    });
    enabledProviderIds$.set(['codex']);

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5-codex',
        variant: 'default',
        portal: false,
      },
    });

    expect(await screen.findByText('Showing default model list.')).toBeTruthy();
    expect(screen.getByText(/Install Codex CLI to see all your available models/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Setup docs/ }).getAttribute('href')).toBe(
      'https://developers.openai.com/codex/cli#cli-setup',
    );
  });

  it('suppresses the Codex install notice when a stale warning accompanies real models', async () => {
    // PROTOCOL §5.30/§6.7 degraded-but-cached response: the daemon serves the
    // last-known-good list with `stale: true` after a transient probe failure,
    // so the models on screen are real and the install prompt would be wrong.
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => {
      if (providerId === 'codex') {
        return {
          models: [{ value: 'codex:gpt-5-codex', label: 'GPT-5 Codex', description: 'Smart' }],
          warning: 'probe timed out; serving last known model list',
          stale: true,
        };
      }

      return { models: [] };
    });
    enabledProviderIds$.set(['codex']);

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5-codex',
        variant: 'default',
        portal: false,
      },
    });

    await waitFor(() => {
      expect(get(providerStaleFlags$)).toEqual({ codex: true });
    });
    expect(screen.queryByText('Showing default model list.')).toBeNull();
    expect(screen.queryByText(/Install Codex CLI to see all your available models/)).toBeNull();
  });

  it('keeps the Codex install notice when the warning arrives with no codex models', async () => {
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => {
      if (providerId === 'codex') {
        return { models: [], warning: 'codex: CLI not found' };
      }

      return { models: [] };
    });
    enabledProviderIds$.set(['codex']);

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5-codex',
        variant: 'default',
        portal: false,
      },
    });

    expect(await screen.findByText('Showing default model list.')).toBeTruthy();
    expect(screen.getByText(/Install Codex CLI to see all your available models/)).toBeTruthy();
  });

  it('does not show the Codex stale-list notice when no fallback warning is present', async () => {
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({
      models: [{ value: 'codex:gpt-5-codex', label: 'GPT-5 Codex', description: 'Smart' }],
    });
    enabledProviderIds$.set(['codex']);

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5-codex',
        variant: 'default',
        portal: false,
      },
    });

    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('codex');
    });
    expect(screen.queryByText('Showing default model list.')).toBeNull();
  });

  it('shows the real provider error when the only enabled provider fails', async () => {
    vi.mocked(getModelsForProvider).mockRejectedValue(new Error('Auggie: CLI not found'));
    enabledProviderIds$.set(['auggie']);

    render(ModelPicker, {
      props: {
        selectedModel: 'gpt5.4',
        portal: false,
      },
    });

    await waitFor(() => {
      expect(vi.mocked(getModelsForProvider)).toHaveBeenCalledWith('auggie');
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByText('Augment Auggie: CLI not found')).toBeTruthy();
    expect(screen.getByText(/npm install -g @augmentcode\/auggie/)).toBeTruthy();
  });

  it('renders without error in unlocked mode', () => {
    render(ModelPicker, {
      props: {
        selectedModel: 'gpt5.4',
        variant: 'outline',
      },
    });

    const container = document.body;
    expect(container).toBeTruthy();
    expect(container.querySelector('[data-icon="lock"]')).toBeNull();
    expect(screen.getByRole('button').className).toContain('border-border!');
    expect(screen.getByRole('button').className).toContain('focus-visible:border-ring!');
    expect(screen.getByRole('button').className).toContain('focus-visible:ring-ring/40');
  });

  it('shows default model text when no model is explicitly selected', () => {
    render(ModelPicker, {
      props: {},
    });

    const container = document.body;
    expect(container).toBeTruthy();
  });

  it('shows the selected model label in the trigger button', () => {
    render(ModelPicker, {
      props: {
        selectedModel: 'gpt5.4',
        isLocked: true,
        providerId: 'auggie',
      },
    });

    const button = screen.getByRole('button');
    expect(button.textContent).toContain('GPT 5.4');
  });

  it('uses a two-unit gap between the trigger icon and model label', () => {
    render(ModelPicker, {
      props: {
        selectedModel: 'gpt5.4',
        providerId: 'auggie',
      },
    });

    const triggerContent = screen
      .getByRole('button')
      .querySelector('span.inline-flex.items-center');
    expect(triggerContent?.classList.contains('gap-2')).toBe(true);
  });

  it('keeps a just-picked local model through a transient undefined selectedModel prop', async () => {
    const { rerender } = render(ModelPicker, {
      props: {
        selectedModel: undefined,
        portal: false,
      },
    });

    await waitFor(() => {
      expect(screen.getByRole('button').textContent).toContain('Default model');
    });

    await fireEvent.click(screen.getByRole('button'));
    await fireEvent.click(await screen.findByRole('option', { name: /Model 1/ }));

    await waitFor(() => {
      expect(screen.getByRole('button').textContent).toContain('Model 1');
    });

    await rerender({ selectedModel: undefined, portal: false });

    expect(screen.getByRole('button').textContent).toContain('Model 1');
  });

  it('shows default model option when selectedModel is null (BE-persisted unset)', async () => {
    render(ModelPicker, {
      props: {
        selectedModel: null,
        portal: false,
      },
    });

    await waitFor(() => {
      expect(screen.getByRole('button').textContent).toContain('Default model');
    });
  });

  it('does not silently switch when the selected model is a compound default-provider ID matching a bare dropdown entry', async () => {
    const { agentClient } = await import('$features/agent/agent.client');
    const { toast } = await import('svelte-sonner');
    vi.mocked(getModelsForProvider).mockImplementation((providerId) => {
      if (providerId === 'auggie') {
        return Promise.resolve([{ value: 'sonnet4.6', label: 'Sonnet 4.6', description: 'Smart' }]);
      }
      return Promise.resolve([]);
    });

    enabledProviderIds$.set(['auggie']);
    activeProviderId$.set('auggie');

    const onModelChange = vi.fn();

    render(ModelPicker, {
      props: {
        selectedModel: 'auggie:sonnet4.6',
        agentId: 'test-agent',
        onModelChange,
      },
    });

    // Wait for provider fetch to settle
    await waitFor(() => {
      expect(vi.mocked(getModelsForProvider)).toHaveBeenCalledWith('auggie');
    });
    // Give the $effect scheduler a chance to run auto-fallback if it were going to
    await new Promise((r) => setTimeout(r, 100));

    expect(onModelChange).not.toHaveBeenCalled();
    expect(vi.mocked(agentClient.setModel)).not.toHaveBeenCalled();
    expect(vi.mocked(toast.info)).not.toHaveBeenCalled();
  });

  it('never rewrites a <provider>:default selection mapped by D2 (no setModel, no fallback toast)', async () => {
    const { agentClient } = await import('$features/agent/agent.client');
    const { toast } = await import('svelte-sonner');
    // Settled catalog with real rows but no isDefault row — the selection
    // renders via the D2 first-model mapping; the persisted value must not
    // be rewritten (filtering is display-only).
    vi.mocked(getModelsForProvider).mockImplementation((providerId) => {
      if (providerId === 'auggie') {
        return Promise.resolve([
          { value: 'auggie:sonnet4.6', label: 'Sonnet 4.6', description: 'Smart' },
          { value: 'auggie:opus4.5', label: 'Opus 4.5', description: 'Smarter' },
        ]);
      }
      return Promise.resolve([]);
    });

    enabledProviderIds$.set(['auggie']);
    activeProviderId$.set('auggie');

    const onModelChange = vi.fn();

    render(ModelPicker, {
      props: {
        selectedModel: 'auggie:default',
        agentId: 'test-agent',
        onModelChange,
      },
    });

    await waitFor(() => {
      expect(vi.mocked(getModelsForProvider)).toHaveBeenCalledWith('auggie');
    });
    // Give the $effect scheduler a chance to run auto-fallback if it were going to
    await new Promise((r) => setTimeout(r, 100));

    expect(onModelChange).not.toHaveBeenCalled();
    expect(vi.mocked(agentClient.setModel)).not.toHaveBeenCalled();
    expect(vi.mocked(toast.info)).not.toHaveBeenCalled();
  });

  it('still triggers fallback when a non-default-provider compound model ID is unavailable', async () => {
    const { toast } = await import('svelte-sonner');
    vi.mocked(getModelsForProvider).mockImplementation((providerId) => {
      if (providerId === 'auggie') {
        return Promise.resolve([
          { value: 'auggie:sonnet4.6', label: 'Sonnet 4.6', description: 'Smart' },
        ]);
      }
      if (providerId === 'opencode') {
        return Promise.resolve([
          { value: 'opencode:real-model', label: 'Real Model', description: 'Real' },
        ]);
      }
      return Promise.resolve([]);
    });

    enabledProviderIds$.set(['auggie', 'opencode']);
    // Active provider must match the selected model's provider so the
    // auto-fallback doesn't treat this as a provider switch.
    activeProviderId$.set('opencode');

    const onModelChange = vi.fn();

    render(ModelPicker, {
      props: {
        selectedModel: 'opencode:nonexistent-xyz',
        agentId: 'test-agent',
        onModelChange,
      },
    });

    await waitFor(() => {
      expect(onModelChange).toHaveBeenCalledWith('opencode:real-model', {
        providerId: 'opencode',
        modelId: 'real-model',
      });
    });
    expect(vi.mocked(toast.info)).toHaveBeenCalled();

    // Reset for other tests
    activeProviderId$.set('auggie');
  });
});

describe('ModelPicker availability gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelState.selectedModel = 'gpt5.4';
    mockModelState.loadError = null;
    mockModelState.availableModels = [];
    providerWarnings$.set({});
    mockSvelteDispatch.mockClear();
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({ models: [] });
    enabledProviderIds$.set(['auggie']);
    activeProviderId$.set('auggie');
    availableProviderOverride$.set(null);
    hasCheckedOnce$.set(true);
    daemonHealth$.set('healthy');
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    availableProviderOverride$.set(null);
    hasCheckedOnce$.set(true);
    daemonHealth$.set('healthy');
  });

  it('does not show the no-provider failure notice or toast while availability has not been checked yet', async () => {
    const { toast } = await import('svelte-sonner');
    hasCheckedOnce$.set(false);
    availableProviderOverride$.set([]);

    render(ModelPicker, {
      props: { portal: false },
    });

    await screen.findByRole('button');

    expect(screen.queryByText('No provider available')).toBeNull();
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it('loads enabled provider models while the availability check is still pending', async () => {
    hasCheckedOnce$.set(false);
    availableProviderOverride$.set([]);
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({
      models: [{ value: 'sonnet4.6', label: 'Sonnet 4.6', description: 'Smart model' }],
    });

    render(ModelPicker, {
      props: { portal: false },
    });

    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('auggie');
    });

    await fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('Sonnet 4.6')).toBeTruthy();
    expect(screen.queryByText('No models available')).toBeNull();
  });

  it('shows the no-provider state only inside the dropdown and fires a toast', async () => {
    const { toast } = await import('svelte-sonner');
    availableProviderOverride$.set([]);

    render(ModelPicker, {
      props: { portal: false },
    });

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalled();
    });
    expect(screen.queryByText('No provider available')).toBeNull();

    await fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByText('No provider available')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeTruthy();
  });

  it('opens provider settings from the dropdown no-provider state', async () => {
    const { navigateToSettings } = await import('$lib/utils/workspace-navigation');
    vi.mocked(navigateToSettings).mockResolvedValue(undefined);
    availableProviderOverride$.set([]);

    render(ModelPicker, { props: { portal: false } });

    await fireEvent.click(screen.getByRole('button'));
    await fireEvent.click(await screen.findByRole('button', { name: 'Open Settings' }));

    expect(vi.mocked(navigateToSettings)).toHaveBeenCalledWith({
      tab: 'accounts',
      hash: 'providers',
    });
  });

  it('passes a stable toast id so no-provider toasts from multiple instances or re-fires collapse into one', async () => {
    // Regression (intent-hq/monorepo#1856): the per-instance dedupe flag does
    // not prevent stacking across mounted pickers or condition flickers — the
    // stable svelte-sonner id is the authoritative dedupe.
    const { toast } = await import('svelte-sonner');
    availableProviderOverride$.set([]);

    render(ModelPicker, { props: { portal: false } });
    render(ModelPicker, { props: { portal: false } });

    await waitFor(() => {
      expect(vi.mocked(toast.error).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    // Flicker the condition false -> true to re-fire the toast. Wait for the
    // intermediate true state to be observable (both pickers drop the notice)
    // so the flicker registers before flipping back.
    availableProviderOverride$.set(['auggie']);
    await waitFor(() => {
      expect(screen.queryAllByText('No provider available')).toHaveLength(0);
    });
    availableProviderOverride$.set([]);

    const callsSoFar = vi.mocked(toast.error).mock.calls.length;
    await waitFor(() => {
      expect(vi.mocked(toast.error).mock.calls.length).toBeGreaterThan(callsSoFar);
    });

    for (const call of vi.mocked(toast.error).mock.calls) {
      expect((call[1] as { id?: string } | undefined)?.id).toBe('no-provider-available');
    }
  });

  it('gives the no-provider toast an action that opens provider settings', async () => {
    const { toast } = await import('svelte-sonner');
    const { navigateToSettings } = await import('$lib/utils/workspace-navigation');
    vi.mocked(navigateToSettings).mockResolvedValue(undefined);
    availableProviderOverride$.set([]);

    render(ModelPicker, {
      props: { portal: false },
    });

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalled();
    });

    const options = vi.mocked(toast.error).mock.calls[0][1] as
      { action?: { label: string; onClick: () => void } } | undefined;
    expect(options?.action?.label).toBe('Open Settings');

    options?.action?.onClick();

    expect(vi.mocked(navigateToSettings)).toHaveBeenCalledWith({
      tab: 'accounts',
      hash: 'providers',
    });
  });

  it('suppresses the no-provider notice and toast while the daemon is not yet connected (pre-connect probe failure)', async () => {
    // Regression (startup window): the mount-time ensureProvidersChecked can
    // run its bulk probe before the daemon socket is up — every probe fails,
    // hasCheckedOnce flips, and availableEnabledProviderIds is [] — which
    // must NOT fire the D1(B) toast/notice while daemon health is 'down'.
    const { toast } = await import('svelte-sonner');
    daemonHealth$.set('down');
    hasCheckedOnce$.set(true);
    availableProviderOverride$.set([]);

    render(ModelPicker, {
      props: { portal: false },
    });

    await screen.findByRole('button');
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.queryByText('No provider available')).toBeNull();
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();

    // Once the daemon connects, a still-empty availability map is a real
    // confirmed failure — the toast fires and the dropdown owns the visible state.
    daemonHealth$.set('healthy');

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalled();
    });
    expect(screen.queryByText('No provider available')).toBeNull();
    await fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('No provider available')).toBeTruthy();
  });

  it('suppresses the no-provider notice and toast while daemon heartbeat health is degraded', async () => {
    const { toast } = await import('svelte-sonner');
    daemonHealth$.set('degraded');
    hasCheckedOnce$.set(true);
    availableProviderOverride$.set([]);

    render(ModelPicker, {
      props: { portal: false },
    });

    await screen.findByRole('button');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.queryByText('No provider available')).toBeNull();
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it('does not show the no-provider failure notice or toast when a provider is available', async () => {
    const { toast } = await import('svelte-sonner');
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({
      models: [{ value: 'auggie:sonnet4.6', label: 'Sonnet 4.6', description: 'Smart model' }],
    });

    render(ModelPicker, {
      props: { portal: false },
    });

    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('auggie');
    });

    expect(screen.queryByText('No provider available')).toBeNull();
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it('excludes an enabled-but-unavailable provider from the rendered model list', async () => {
    const { toast } = await import('svelte-sonner');
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => {
      if (providerId === 'codex') {
        return {
          models: [{ value: 'codex:gpt-5-codex', label: 'GPT-5 Codex', description: 'Smart' }],
        };
      }
      return { models: [{ value: 'auggie:sonnet4.6', label: 'Sonnet 4.6', description: 'Smart' }] };
    });
    enabledProviderIds$.set(['auggie', 'codex']);
    availableProviderOverride$.set(['codex']);

    render(ModelPicker, {
      props: { selectedModel: 'codex:gpt-5-codex', portal: false },
    });

    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('codex');
    });
    expect(vi.mocked(getModelsForProviderForLoadingState)).not.toHaveBeenCalledWith('auggie');

    await fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByRole('option', { name: /GPT-5 Codex/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Sonnet 4\.6/ })).toBeNull();
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it('dispatches ensureProvidersChecked on mount so availability is populated outside onboarding', async () => {
    const { ensureProvidersChecked } =
      await import('$store/renderer/slices/agent-availability/agent-availability-slice');

    render(ModelPicker, {
      props: { portal: false },
    });

    expect(
      mockSvelteDispatch.mock.calls.some(
        ([action]) => (action as { type?: string }).type === ensureProvidersChecked.type,
      ),
    ).toBe(true);
  });

  it('does not render stale models from another provider under the active provider group label', async () => {
    // Regression (mislabeled group): availability map still empty, active
    // provider switched to grok, but the globally-loaded catalog still holds
    // the previously loaded Auggie models. Those rows must NOT render under
    // a "Grok Build" group label.
    hasCheckedOnce$.set(false);
    availableProviderOverride$.set([]);
    enabledProviderIds$.set(['grok']);
    activeProviderId$.set('grok');
    mockModelState.availableModels = [
      { value: 'gpt5.4', label: 'GPT 5.4', description: 'Smart model' },
    ];
    mockModelState.availableModelsProviderId = 'auggie';

    render(ModelPicker, {
      props: { portal: false },
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(screen.queryByRole('option', { name: /GPT 5\.4/ })).toBeNull();
    expect(screen.queryByText('Grok Build')).toBeNull();

    // Reset for other tests
    activeProviderId$.set('auggie');
  });

  it('still renders the disabled effective provider group when the catalog was loaded for it', async () => {
    // Positive control for the provenance gate: when the global catalog DOES
    // belong to the (unavailable) effective provider, the fallback group must
    // keep rendering so the selected model isn't orphaned.
    hasCheckedOnce$.set(false);
    availableProviderOverride$.set([]);
    enabledProviderIds$.set(['grok']);
    activeProviderId$.set('grok');
    mockModelState.availableModels = [
      { value: 'grok:grok-4', label: 'Grok 4', description: 'Smart model' },
    ];
    mockModelState.availableModelsProviderId = 'grok';

    render(ModelPicker, {
      props: { portal: false },
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByRole('option', { name: /Grok 4/ })).toBeTruthy();
    expect(screen.getAllByText('Grok Build').length).toBeGreaterThan(0);

    // Reset for other tests
    activeProviderId$.set('auggie');
  });
});

describe('ModelPicker selected-model loading state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelState.selectedModel = 'auggie:sonnet4.6';
    mockModelState.loadError = null;
    mockModelState.availableModels = [];
    mockModelState.availableModelsProviderId = '';
    providerWarnings$.set({});
    mockSvelteDispatch.mockClear();
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({ models: [] });
    enabledProviderIds$.set(['auggie']);
    activeProviderId$.set('auggie');
    availableProviderOverride$.set(null);
    hasCheckedOnce$.set(true);
    daemonHealth$.set('healthy');
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    availableProviderOverride$.set(null);
    hasCheckedOnce$.set(true);
    mockModelState.availableModelsProviderId = 'auggie';
  });

  it('shows a spinner instead of the warning while availability has not hydrated yet, then clears once the model arrives', async () => {
    // Regression (transient warning on refresh): with the availability list not
    // hydrated, fetchAllProviderModels([]) marks the catalog "loaded" while
    // empty — the selected model must read as still-loading, not unavailable.
    hasCheckedOnce$.set(false);
    availableProviderOverride$.set([]);
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({
      models: [{ value: 'auggie:sonnet4.6', label: 'Sonnet 4.6', description: 'Smart' }],
    });

    render(ModelPicker, {
      props: { selectedModel: 'auggie:sonnet4.6', agentId: 'test-agent', portal: false },
    });

    const trigger = await screen.findByRole('button');
    await new Promise((r) => setTimeout(r, 100));

    expect(trigger.querySelector('[data-icon="triangle-exclamation"]')).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();

    // Availability hydrates and the provider's catalog resolves with the model.
    hasCheckedOnce$.set(true);
    availableProviderOverride$.set(['auggie']);

    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull();
    });
    expect(trigger.querySelector('[data-icon="triangle-exclamation"]')).toBeNull();
    expect(trigger.textContent).toContain('Sonnet 4.6');
  });

  it('treats a bare selected model as available when its provider catalog uses a compound id', async () => {
    const { agentClient } = await import('$features/agent/agent.client');
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({
      models: [{ value: 'auggie:gpt5.6-sol', label: 'GPT 5.6', description: 'Smart' }],
    });

    render(ModelPicker, {
      props: { selectedModel: 'gpt5.6-sol', agentId: 'test-agent', portal: false },
    });

    const trigger = await screen.findByRole('button');
    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('auggie');
    });
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());

    expect(trigger.querySelector('[data-icon="triangle-exclamation"]')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(vi.mocked(agentClient.setModel)).not.toHaveBeenCalled();
  });

  it('shows the warning once the selected model provider has settled without the model', async () => {
    hasCheckedOnce$.set(false);
    availableProviderOverride$.set([]);
    // Empty catalog so the auto-fallback has no candidate and the warning stays.
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({ models: [] });

    render(ModelPicker, {
      props: { selectedModel: 'auggie:sonnet4.6', agentId: 'test-agent', portal: false },
    });

    const trigger = await screen.findByRole('button');
    await new Promise((r) => setTimeout(r, 100));

    expect(trigger.querySelector('[data-icon="triangle-exclamation"]')).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();

    hasCheckedOnce$.set(true);
    availableProviderOverride$.set(['auggie']);

    await waitFor(() => {
      expect(trigger.querySelector('[data-icon="triangle-exclamation"]')).not.toBeNull();
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('never shows the warning while the selected model provider fetch is still in flight', async () => {
    let resolveFetch:
      | ((result: { models: { value: string; label: string; description: string }[] }) => void)
      | undefined;
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    render(ModelPicker, {
      props: { selectedModel: 'auggie:sonnet4.6', agentId: 'test-agent', portal: false },
    });

    const trigger = await screen.findByRole('button');
    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('auggie');
    });

    expect(trigger.querySelector('[data-icon="triangle-exclamation"]')).toBeNull();

    resolveFetch?.({ models: [] });

    await waitFor(() => {
      expect(trigger.querySelector('[data-icon="triangle-exclamation"]')).not.toBeNull();
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('ModelPicker unlocked agent provider handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelState.selectedModel = 'gpt5.4';
    mockModelState.loadError = null;
    mockModelState.availableModels = [
      { value: 'gpt5.4', label: 'GPT 5.4', description: 'Smart model' },
    ];
    providerWarnings$.set({});
    mockAgentSession$.set(undefined);
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => {
      if (providerId === 'codex') {
        return {
          models: [{ value: 'codex:gpt-5-codex', label: 'GPT-5 Codex', description: 'Smart' }],
        };
      }
      if (providerId === 'auggie') {
        return {
          models: [{ value: 'auggie:sonnet4.6', label: 'Sonnet 4.6', description: 'Smart' }],
        };
      }
      return { models: [] };
    });
    enabledProviderIds$.set(['auggie']);
    activeProviderId$.set('auggie');
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    mockAgentSession$.set(undefined);
    activeProviderId$.set('auggie');
  });

  it('shows all enabled providers when the agent session provider differs from the active provider', async () => {
    enabledProviderIds$.set(['auggie', 'codex']);
    mockAgentSession$.set({ id: 'agent-1', workspaceId: 'ws-1', provider: 'codex' });

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5-codex',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));

    // The agent's provider is visible…
    expect(await screen.findByRole('option', { name: /GPT-5 Codex/ })).toBeTruthy();
    // …and so is every other enabled provider — not just the agent's.
    expect(await screen.findByRole('option', { name: /Sonnet 4\.6/ })).toBeTruthy();
  });

  it('fetches and shows a newly enabled provider group live (unlocked, agent present)', async () => {
    enabledProviderIds$.set(['auggie']);
    mockAgentSession$.set({ id: 'agent-1', workspaceId: 'ws-1', provider: 'auggie' });

    render(ModelPicker, {
      props: {
        selectedModel: 'auggie:sonnet4.6',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByRole('option', { name: /Sonnet 4\.6/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /GPT-5 Codex/ })).toBeNull();

    // Toggling a provider ON in Settings reaches the picker as an update to
    // the enabled-provider-ids selector (settings:changed →
    // applySettingsChanges → loadEnabledProvidersFromStorage → selector; that
    // leg is asserted in daemon-events-bridge.client.test.ts). The picker must
    // refetch and show the new provider's group without a restart.
    enabledProviderIds$.set(['auggie', 'codex']);

    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('codex');
    });
    expect(await screen.findByRole('option', { name: /GPT-5 Codex/ })).toBeTruthy();
  });

  it('fetches an enabled agent provider only once in unlocked mode (no duplicate wire fetch)', async () => {
    enabledProviderIds$.set(['auggie', 'codex']);
    mockAgentSession$.set({ id: 'agent-1', workspaceId: 'ws-1', provider: 'codex' });

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5-codex',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByRole('option', { name: /GPT-5 Codex/ })).toBeTruthy();
    expect(await screen.findByRole('option', { name: /Sonnet 4\.6/ })).toBeTruthy();

    // The agent's provider is enabled, so its models are already covered by the
    // all-providers fetch — the per-agent fetch must not fire a duplicate call.
    const codexCalls = vi
      .mocked(getModelsForProviderForLoadingState)
      .mock.calls.filter(([pid]) => pid === 'codex');
    expect(codexCalls).toHaveLength(1);
  });

  it('group refresh in unlocked mode updates the group list via allProviderModels', async () => {
    enabledProviderIds$.set(['auggie', 'codex']);
    mockAgentSession$.set({ id: 'agent-1', workspaceId: 'ws-1', provider: 'codex' });

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5-codex',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('option', { name: /GPT-5 Codex/ })).toBeTruthy();

    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => {
      if (providerId === 'codex') {
        return {
          models: [{ value: 'codex:gpt-6-codex', label: 'GPT-6 Codex', description: 'Smarter' }],
        };
      }
      return { models: [] };
    });

    await fireEvent.click(screen.getByTitle('Refresh OpenAI Codex models'));

    // The refreshed list replaces the group (allProviderModels path); the
    // per-agent snapshot is not used for an enabled provider in unlocked mode.
    expect(await screen.findByRole('option', { name: /GPT-6 Codex/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /GPT-5 Codex/ })).toBeNull();
  });

  it('keeps the agent provider group visible when that provider was since disabled', async () => {
    enabledProviderIds$.set(['auggie']);
    mockAgentSession$.set({ id: 'agent-1', workspaceId: 'ws-1', provider: 'codex' });

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5-codex',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));

    // The enabled providers are all listed…
    expect(await screen.findByRole('option', { name: /Sonnet 4\.6/ })).toBeTruthy();
    // …and the agent's (now disabled) provider group stays visible so the
    // currently selected model isn't orphaned.
    expect(await screen.findByRole('option', { name: /GPT-5 Codex/ })).toBeTruthy();
  });

  it('includes the disabled effective provider in reasoning provider tabs', async () => {
    enabledProviderIds$.set(['auggie']);
    mockAgentSession$.set({ id: 'agent-1', workspaceId: 'ws-1', provider: 'codex' });

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5-codex',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        showReasoning: true,
        portal: false,
      },
    });

    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('codex');
    });
    await fireEvent.click(screen.getByRole('button'));

    expect(screen.getByRole('tab', { name: /Auggie/ })).toBeTruthy();
    const codexTab = await screen.findByRole('tab', { name: /Codex/ });
    expect(codexTab.getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByRole('option', { name: /GPT-5 Codex/ })).toBeTruthy();
  });

  it('retries the disabled agent provider fetch', async () => {
    let codexAttempts = 0;
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => {
      if (providerId === 'codex') {
        codexAttempts += 1;
        if (codexAttempts === 1) throw new Error('Codex unavailable');
        return {
          models: [{ value: 'codex:gpt-6-codex', label: 'GPT-6 Codex', description: 'Smarter' }],
        };
      }
      return { models: [] };
    });
    enabledProviderIds$.set(['auggie']);
    mockAgentSession$.set({ id: 'agent-1', workspaceId: 'ws-1', provider: 'codex' });

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-6-codex',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        portal: false,
      },
    });

    await waitFor(() => expect(codexAttempts).toBe(1));
    await fireEvent.click(screen.getByRole('button'));
    await fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(codexAttempts).toBe(2));
    expect(await screen.findByRole('option', { name: /GPT-6 Codex/ })).toBeTruthy();
  });

  it('shows all enabled providers when providerId is explicitly passed', async () => {
    enabledProviderIds$.set(['auggie', 'codex']);

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5-codex',
        providerId: 'codex',
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByRole('option', { name: /GPT-5 Codex/ })).toBeTruthy();
    expect(await screen.findByRole('option', { name: /Sonnet 4\.6/ })).toBeTruthy();
  });

  it('shows all enabled providers when providerId matches the active provider', async () => {
    enabledProviderIds$.set(['auggie', 'codex']);
    activeProviderId$.set('codex');
    mockModelState.availableModels = [
      { value: 'codex:gpt-5-codex', label: 'GPT-5 Codex', description: 'Smart' },
    ];

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5-codex',
        providerId: 'codex',
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByRole('option', { name: /GPT-5 Codex/ })).toBeTruthy();
    expect(await screen.findByRole('option', { name: /Sonnet 4\.6/ })).toBeTruthy();
  });
});

describe('ModelPicker global-default vs per-agent dispatch gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelState.selectedModel = 'gpt5.4';
    mockModelState.loadError = null;
    mockModelState.availableModels = [
      { value: 'model-1', label: 'Model 1', description: 'A model' },
    ];
    providerWarnings$.set({});
    mockAgentSession$.set(undefined);
    mockSvelteDispatch.mockClear();
    vi.mocked(getModelsForProvider).mockResolvedValue([
      { value: 'model-1', label: 'Model 1', description: 'A model' },
    ]);
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => ({
      models: await vi.mocked(getModelsForProvider)(providerId),
    }));
    enabledProviderIds$.set(['auggie']);
    activeProviderId$.set('auggie');
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    mockAgentSession$.set(undefined);
  });

  const pickModelOne = async () => {
    await fireEvent.click(screen.getByRole('button'));
    await fireEvent.click(await screen.findByRole('option', { name: /Model 1/ }));
    // handleModelSelect awaits a tick before dispatching — let it settle.
    await new Promise((r) => setTimeout(r, 0));
  };

  const dispatchedTypes = () =>
    mockSvelteDispatch.mock.calls.map(([action]) => (action as { type?: string }).type);

  it('spawn context (no flags): a pick dispatches neither selectModel nor any agent-session update', async () => {
    const { agentClient } = await import('$features/agent/agent.client');
    const onModelChange = vi.fn();

    render(ModelPicker, {
      props: { onModelChange, portal: false },
    });

    await pickModelOne();

    expect(onModelChange).toHaveBeenCalledWith('model-1', {
      providerId: 'auggie',
      modelId: 'model-1',
    });
    expect(dispatchedTypes()).not.toContain(selectModel.type);
    expect(dispatchedTypes()).not.toContain('agentSession/updateSession');
    expect(vi.mocked(agentClient.setModel)).not.toHaveBeenCalled();
  });

  it('chat-input context (updateGlobalStore): a pick updates the agent but never the global default', async () => {
    const { agentClient } = await import('$features/agent/agent.client');
    mockAgentSession$.set({ id: 'agent-1', workspaceId: 'ws-1', provider: 'auggie' });

    render(ModelPicker, {
      props: {
        workspaceId: 'ws-1',
        agentId: 'agent-1',
        updateGlobalStore: true,
        portal: false,
      },
    });

    await pickModelOne();

    await waitFor(() => {
      expect(dispatchedTypes()).toContain('agentSession/updateSession');
    });
    // Bare model id → the effective default provider ('auggie', the
    // settings-designated providers.active) rides along as the explicit
    // providerId on the wire call.
    expect(vi.mocked(agentClient.setModel)).toHaveBeenCalledWith(
      'agent-1',
      'model-1',
      'ws-1',
      'auggie',
    );
    // The global default (selectModel → model.providerDefaults /
    // providers.active persistence) must never fire from the chat input.
    expect(dispatchedTypes()).not.toContain(selectModel.type);
  });

  it('reconciles the current effort against the picked model after the model update succeeds', async () => {
    reasoningEffort$.set('xhigh');
    mockAgentSession$.set({ id: 'agent-1', workspaceId: 'ws-1', provider: 'auggie' });
    mockModelState.availableModels = [
      {
        value: 'model-1',
        label: 'Model 1',
        description: 'A model',
        effortLevels: ['low', 'high'],
      },
    ];
    vi.mocked(getModelsForProvider).mockResolvedValue(mockModelState.availableModels);

    render(ModelPicker, {
      props: {
        workspaceId: 'ws-1',
        agentId: 'agent-1',
        updateGlobalStore: true,
        portal: false,
      },
    });

    await pickModelOne();

    await waitFor(() => {
      expect(reconcileAgentReasoningEffortMock).toHaveBeenCalledWith('agent-1', 'ws-1', 'xhigh', [
        'low',
        'high',
      ]);
    });
  });

  it('cross-provider pick (intent-hq/monorepo#1657): session on claude-code, bare default-provider model → explicit providerId on the wire', async () => {
    const { agentClient } = await import('$features/agent/agent.client');
    // Session provider differs from the default provider — the historical
    // failure: the daemon validated the bare id against claude-code and
    // rejected it. The FE must attribute the bare pick to the effective
    // default provider explicitly.
    mockAgentSession$.set({ id: 'agent-1', workspaceId: 'ws-1', provider: 'claude-code' });

    render(ModelPicker, {
      props: {
        workspaceId: 'ws-1',
        agentId: 'agent-1',
        updateGlobalStore: true,
        portal: false,
      },
    });

    await pickModelOne();

    await waitFor(() => {
      expect(vi.mocked(agentClient.setModel)).toHaveBeenCalledWith(
        'agent-1',
        'model-1',
        'ws-1',
        'auggie',
      );
    });
  });

  it('bare pick from a non-default provider group resolves the owning provider (catalog ownership)', async () => {
    const { agentClient } = await import('$features/agent/agent.client');
    const onModelChange = vi.fn();
    mockAgentSession$.set({ id: 'agent-1', workspaceId: 'ws-1', provider: 'auggie' });
    // Catalog rows are bare for every provider — the codex group owns the
    // bare 'gpt-5-codex' row, so a pick of it must attribute to codex, not
    // blanket-attribute to the default provider (auggie).
    enabledProviderIds$.set(['auggie', 'codex']);
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => ({
      models:
        providerId === 'codex'
          ? [{ value: 'gpt-5-codex', label: 'GPT-5 Codex', description: 'Codex model' }]
          : [{ value: 'model-1', label: 'Model 1', description: 'A model' }],
    }));

    render(ModelPicker, {
      props: {
        workspaceId: 'ws-1',
        agentId: 'agent-1',
        updateGlobalStore: true,
        portal: false,
        onModelChange,
      },
    });

    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('codex');
    });
    await fireEvent.click(screen.getByRole('button'));
    await fireEvent.click(await screen.findByRole('option', { name: /GPT-5 Codex/ }));
    await new Promise((r) => setTimeout(r, 0));

    expect(onModelChange).toHaveBeenCalledWith('gpt-5-codex', {
      providerId: 'codex',
      modelId: 'gpt-5-codex',
    });
    await waitFor(() => {
      expect(vi.mocked(agentClient.setModel)).toHaveBeenCalledWith(
        'agent-1',
        'gpt-5-codex',
        'ws-1',
        'codex',
      );
    });
  });

  // Legacy boundary: compound `provider:model` ids no longer exist as catalog
  // rows, but persisted selections can still carry them — the prefix must win
  // provider attribution outright.
  it('compound model pick sends the compound prefix as the explicit providerId', async () => {
    const { agentClient } = await import('$features/agent/agent.client');
    mockAgentSession$.set({ id: 'agent-1', workspaceId: 'ws-1', provider: 'auggie' });
    mockModelState.availableModels = [
      { value: 'codex:gpt-5-codex', label: 'GPT-5 Codex', description: 'Smart' },
    ];
    vi.mocked(getModelsForProvider).mockResolvedValue([
      { value: 'codex:gpt-5-codex', label: 'GPT-5 Codex', description: 'Smart' },
    ]);

    render(ModelPicker, {
      props: {
        workspaceId: 'ws-1',
        agentId: 'agent-1',
        updateGlobalStore: true,
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));
    await fireEvent.click(await screen.findByRole('option', { name: /GPT-5 Codex/ }));
    await new Promise((r) => setTimeout(r, 0));

    await waitFor(() => {
      expect(vi.mocked(agentClient.setModel)).toHaveBeenCalledWith(
        'agent-1',
        'codex:gpt-5-codex',
        'ws-1',
        'codex',
      );
    });
  });

  it('picking "Default model" drops a deferred update queued during streaming', async () => {
    const { agentClient } = await import('$features/agent/agent.client');
    mockAgentSession$.set({ id: 'agent-1', workspaceId: 'ws-1', provider: 'auggie' });

    const { rerender } = render(ModelPicker, {
      props: {
        workspaceId: 'ws-1',
        agentId: 'agent-1',
        updateGlobalStore: true,
        deferUpdate: true,
        showDefaultOption: true,
        portal: false,
      },
    });

    // Pick an explicit model while streaming — the backend update is deferred.
    await pickModelOne();
    expect(vi.mocked(agentClient.setModel)).not.toHaveBeenCalled();

    // Then pick "Default model" — this must clear the queued deferred update.
    await fireEvent.click(screen.getAllByRole('button')[0]);
    await fireEvent.click(await screen.findByRole('option', { name: /Default model/ }));
    await new Promise((r) => setTimeout(r, 0));

    // Streaming ends: the stale deferred update must not apply.
    await rerender({
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      updateGlobalStore: true,
      deferUpdate: false,
      showDefaultOption: true,
      portal: false,
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(vi.mocked(agentClient.setModel)).not.toHaveBeenCalled();
  });

  it('settings context (updateGlobalDefault): a pick dispatches the global selectModel', async () => {
    render(ModelPicker, {
      props: { updateGlobalDefault: true, portal: false },
    });

    await pickModelOne();

    await waitFor(() => {
      expect(dispatchedTypes()).toContain(selectModel.type);
    });
    const selectModelActions = mockSvelteDispatch.mock.calls
      .map(([action]) => action as { type?: string; payload?: unknown })
      .filter((action) => action.type === selectModel.type);
    expect(selectModelActions[0]?.payload).toEqual(['model-1', 'auggie']);
    expect(dispatchedTypes()).not.toContain('agentSession/updateSession');
  });
});

describe('ModelPicker confirmModelChange gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelState.selectedModel = 'gpt5.4';
    mockModelState.loadError = null;
    mockModelState.availableModels = [
      { value: 'model-1', label: 'Model 1', description: 'A model' },
    ];
    providerWarnings$.set({});
    mockAgentSession$.set(undefined);
    vi.mocked(getModelsForProvider).mockResolvedValue([
      { value: 'model-1', label: 'Model 1', description: 'A model' },
      { value: 'model-2', label: 'Model 2', description: 'Another model' },
    ]);
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => ({
      models: await vi.mocked(getModelsForProvider)(providerId),
    }));
    enabledProviderIds$.set(['auggie']);
    activeProviderId$.set('auggie');
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('applies the pick when the gate resolves true', async () => {
    const onModelChange = vi.fn();
    const confirmModelChange = vi.fn().mockResolvedValue(true);

    render(ModelPicker, {
      props: { selectedModel: 'model-1', onModelChange, confirmModelChange, portal: false },
    });

    await fireEvent.click(screen.getByRole('button'));
    await fireEvent.click(await screen.findByRole('option', { name: /Model 2/ }));

    await waitFor(() => {
      expect(onModelChange).toHaveBeenCalledWith('model-2', {
        providerId: 'auggie',
        modelId: 'model-2',
      });
    });
    expect(confirmModelChange).toHaveBeenCalledWith('model-1', 'model-2');
  });

  it('reverts the pick and skips onModelChange when the gate resolves false', async () => {
    const onModelChange = vi.fn();
    const confirmModelChange = vi.fn().mockResolvedValue(false);

    render(ModelPicker, {
      props: { selectedModel: 'model-1', onModelChange, confirmModelChange, portal: false },
    });

    await fireEvent.click(screen.getByRole('button'));
    await fireEvent.click(await screen.findByRole('option', { name: /Model 2/ }));

    await waitFor(() => {
      expect(confirmModelChange).toHaveBeenCalledWith('model-1', 'model-2');
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(onModelChange).not.toHaveBeenCalled();
    // The trigger still shows the original model after the revert.
    const trigger = screen
      .getAllByRole('button')
      .find((b) => b.textContent?.includes('Model 1') || b.textContent?.includes('Model 2'));
    expect(trigger?.textContent).toContain('Model 1');
    expect(trigger?.textContent).not.toContain('Model 2');
  });

  it('gates switching from an explicit model to "Default model" and passes null as the target', async () => {
    const onModelChange = vi.fn();
    const confirmModelChange = vi.fn().mockResolvedValue(true);

    render(ModelPicker, {
      props: {
        selectedModel: 'model-1',
        onModelChange,
        confirmModelChange,
        portal: false,
        showDefaultOption: true,
      },
    });

    await fireEvent.click(screen.getByRole('button'));
    await fireEvent.click(await screen.findByRole('option', { name: /Default model/ }));

    await waitFor(() => {
      expect(confirmModelChange).toHaveBeenCalledWith('model-1', null);
    });
    // Confirming applies the pick: the trigger now shows "Default model".
    await waitFor(() => {
      const trigger = screen
        .getAllByRole('button')
        .find(
          (b) => b.textContent?.includes('Default model') || b.textContent?.includes('Model 1'),
        );
      expect(trigger?.textContent).toContain('Default model');
    });
  });

  it('reverts an explicit-to-default pick when the gate resolves false', async () => {
    const onModelChange = vi.fn();
    const confirmModelChange = vi.fn().mockResolvedValue(false);

    render(ModelPicker, {
      props: {
        selectedModel: 'model-1',
        onModelChange,
        confirmModelChange,
        portal: false,
        showDefaultOption: true,
      },
    });

    await fireEvent.click(screen.getByRole('button'));
    await fireEvent.click(await screen.findByRole('option', { name: /Default model/ }));

    await waitFor(() => {
      expect(confirmModelChange).toHaveBeenCalledWith('model-1', null);
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(onModelChange).not.toHaveBeenCalled();
    const trigger = screen
      .getAllByRole('button')
      .find((b) => b.textContent?.includes('Model 1') || b.textContent?.includes('Default model'));
    expect(trigger?.textContent).toContain('Model 1');
  });

  it('does not invoke the gate when re-selecting the current model', async () => {
    const onModelChange = vi.fn();
    const confirmModelChange = vi.fn().mockResolvedValue(true);

    render(ModelPicker, {
      props: { selectedModel: 'model-1', onModelChange, confirmModelChange, portal: false },
    });

    await fireEvent.click(screen.getByRole('button'));
    await fireEvent.click(await screen.findByRole('option', { name: /Model 1/ }));

    await new Promise((r) => setTimeout(r, 0));
    expect(confirmModelChange).not.toHaveBeenCalled();
    expect(onModelChange).toHaveBeenCalledWith('model-1', {
      providerId: 'auggie',
      modelId: 'model-1',
    });
  });
});

describe('ModelPicker specialist inherit state (default-option plumbing)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelState.selectedModel = 'gpt5.4';
    mockModelState.loadError = null;
    mockModelState.availableModels = [
      { value: 'model-1', label: 'Model 1', description: 'A model' },
    ];
    providerWarnings$.set({});
    mockAgentSession$.set(undefined);
    vi.mocked(getModelsForProvider).mockResolvedValue([
      { value: 'model-1', label: 'Model 1', description: 'A model' },
      { value: 'model-2', label: 'Model 2', description: 'Another model' },
    ]);
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => ({
      models: await vi.mocked(getModelsForProvider)(providerId),
    }));
    enabledProviderIds$.set(['auggie']);
    activeProviderId$.set('auggie');
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('renders the inherit state with the daemon resolvedModel preview on the trigger (no explicit pin)', async () => {
    render(ModelPicker, {
      props: {
        // Inheriting: no explicit frontmatter model — daemon preview only.
        selectedModel: undefined,
        showDefaultOption: true,
        defaultModelId: 'model-1',
        defaultOptionLabel: 'Default',
        defaultOptionDescription: 'Use the global default model',
        formatDefaultModelLabel: (model: string) => `Default (${model})`,
        portal: false,
      },
    });

    await waitFor(() => {
      const trigger = screen.getAllByRole('button').find((b) => b.textContent?.includes('Default'));
      expect(trigger?.textContent).toContain('Default (Model 1)');
    });
  });

  it('renders the pinned state from an explicit model (preview ignored)', async () => {
    render(ModelPicker, {
      props: {
        selectedModel: 'model-2',
        showDefaultOption: true,
        defaultModelId: 'model-1',
        formatDefaultModelLabel: (model: string) => `Default (${model})`,
        portal: false,
      },
    });

    await waitFor(() => {
      const trigger = screen.getAllByRole('button').find((b) => b.textContent?.includes('Model'));
      expect(trigger?.textContent).toContain('Model 2');
      expect(trigger?.textContent).not.toContain('Default');
    });
  });

  it('shows the custom inherit option label/description in the dropdown', async () => {
    render(ModelPicker, {
      props: {
        selectedModel: 'model-2',
        showDefaultOption: true,
        defaultOptionLabel: 'Default',
        defaultOptionDescription: 'Use the global default model',
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));

    const inheritOption = await screen.findByRole('option', {
      name: /Use the global default model/,
    });
    expect(inheritOption.textContent).toContain('Default');
  });

  it('emits onModelChange("") when the inherit option is picked', async () => {
    const onModelChange = vi.fn();

    render(ModelPicker, {
      props: {
        selectedModel: 'model-2',
        onModelChange,
        showDefaultOption: true,
        defaultOptionLabel: 'Default',
        defaultOptionDescription: 'Use the global default model',
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));
    await fireEvent.click(
      await screen.findByRole('option', { name: /Use the global default model/ }),
    );

    await waitFor(() => {
      expect(onModelChange).toHaveBeenCalledWith('');
    });
  });

  it('emits the model id unchanged when a concrete model is picked (pin path)', async () => {
    const onModelChange = vi.fn();

    render(ModelPicker, {
      props: {
        selectedModel: undefined,
        onModelChange,
        showDefaultOption: true,
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));
    await fireEvent.click(await screen.findByRole('option', { name: /Model 2/ }));

    await waitFor(() => {
      expect(onModelChange).toHaveBeenCalledWith('model-2', {
        providerId: 'auggie',
        modelId: 'model-2',
      });
    });
  });
});

describe('ModelPicker cache hydration (stale-while-revalidate)', () => {
  it('uses live Antigravity labels and preserves exact compound ids without effort controls', async () => {
    enabledProviderIds$.set(['antigravity']);
    activeProviderId$.set('antigravity');
    const model = { value: 'antigravity:gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (High)' };
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({ models: [model] });
    const onModelChange = vi.fn();
    render(ModelPicker, { props: { selectedModel: undefined, onModelChange, portal: false } });
    await fireEvent.click(screen.getByRole('button'));
    await fireEvent.click(await screen.findByRole('option', { name: /Gemini 3.7 Flash \(High\)/ }));
    await waitFor(() =>
      expect(onModelChange).toHaveBeenCalledWith('antigravity:gemini-3.7-flash-high', {
        providerId: 'antigravity',
        modelId: 'gemini-3.7-flash-high',
      }),
    );
    expect(screen.queryByRole('slider')).toBeNull();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelState.selectedModel = 'sonnet4.6';
    mockModelState.loadError = null;
    // The global catalog does NOT contain the selected model — only the
    // seeded providerModels cache (or a settled fetch) can resolve its label.
    mockModelState.availableModels = [];
    enabledProviderIds$.set(['auggie']);
    activeProviderId$.set('auggie');
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  function seedCache() {
    mockProviderModelsState.byProviderId = {
      auggie: {
        models: [{ value: 'sonnet4.6', label: 'Claude Sonnet 4.6', description: 'Smart model' }],
        fetchedAt: new Date().toISOString(),
      },
    };
  }

  it('renders the cached model label immediately with no skeleton while the fetch is pending', async () => {
    seedCache();
    // Revalidation fetch never settles — only the cache can resolve the label.
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(() => new Promise(() => {}));

    render(ModelPicker, {
      props: {
        selectedModel: 'sonnet4.6',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        portal: false,
      },
    });

    const button = screen.getByRole('button');
    // Trigger label resolved on the very first render: pretty name, no
    // skeleton placeholder, no loading spinner.
    expect(button.textContent).toContain('Claude Sonnet 4.6');
    expect(button.querySelector('.animate-pulse')).toBeNull();
    expect(button.querySelector('[role="status"]')).toBeNull();

    // The background revalidation fetch did start (stale-while-revalidate).
    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('auggie');
    });
    await new Promise((r) => setTimeout(r, 0));
    // Still resolved after the debounced background revalidation kicked off.
    expect(button.textContent).toContain('Claude Sonnet 4.6');
    expect(button.querySelector('.animate-pulse')).toBeNull();
    expect(button.querySelector('[role="status"]')).toBeNull();
  });

  it('keeps the skeleton on the uncached first-boot path while the fetch is pending', async () => {
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(() => new Promise(() => {}));

    render(ModelPicker, {
      props: {
        selectedModel: 'sonnet4.6',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        portal: false,
      },
    });

    await new Promise((r) => setTimeout(r, 100));
    const button = screen.getByRole('button');
    expect(button.textContent).not.toContain('Claude Sonnet 4.6');
    expect(button.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('writes successful fetch results through to the cache slice', async () => {
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({
      models: [{ value: 'sonnet4.6', label: 'Claude Sonnet 4.6', description: 'Smart model' }],
    });

    render(ModelPicker, {
      props: {
        selectedModel: 'sonnet4.6',
        portal: false,
      },
    });

    await waitFor(() => {
      const writeThrough = mockSvelteDispatch.mock.calls.find(
        ([action]) => action?.type === 'providerModels/providerModelsLoaded',
      );
      expect(writeThrough).toBeTruthy();
      const [providerId, entry] = writeThrough![0].payload as [
        string,
        { models: { value: string }[]; fetchedAt: string },
      ];
      expect(providerId).toBe('auggie');
      expect(entry.models).toEqual([
        { value: 'sonnet4.6', label: 'Claude Sonnet 4.6', description: 'Smart model' },
      ]);
      expect(Number.isNaN(Date.parse(entry.fetchedAt))).toBe(false);
    });
  });

  it('writes force-refresh (↻) results through to the cache slice', async () => {
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({
      models: [{ value: 'sonnet4.6', label: 'Claude Sonnet 4.6', description: 'Smart model' }],
    });

    render(ModelPicker, {
      props: {
        selectedModel: 'sonnet4.6',
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));
    const refreshButton = await screen.findByRole('button', { name: /Refresh .* models/ });

    mockSvelteDispatch.mockClear();
    vi.mocked(getModelsForProviderForLoadingState).mockClear();
    await fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('auggie', {
        forceRefresh: true,
      });
      const writeThrough = mockSvelteDispatch.mock.calls.find(
        ([action]) => action?.type === 'providerModels/providerModelsLoaded',
      );
      expect(writeThrough).toBeTruthy();
      expect((writeThrough![0].payload as [string, unknown])[0]).toBe('auggie');
    });
  });

  it('refetches when the cache is cleared on reconnect even though provider ids are unchanged', async () => {
    seedCache();
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({
      models: [{ value: 'sonnet4.6', label: 'Claude Sonnet 4.6', description: 'Smart model' }],
    });

    render(ModelPicker, {
      props: {
        selectedModel: 'sonnet4.6',
        portal: false,
      },
    });

    // The initial background revalidation settles.
    await waitFor(() => {
      expect(
        vi
          .mocked(getModelsForProviderForLoadingState)
          .mock.calls.filter(([pid]) => pid === 'auggie'),
      ).toHaveLength(1);
    });

    // Backend reconnect: the seeder dispatches providerModelsCacheCleared and
    // the map goes empty (and the clear epoch bumps). The enabled-provider
    // ids are UNCHANGED, so the fetch-effect dedup key alone would skip —
    // the picker must still revalidate off the cache-clear signal.
    mockProviderModelsState.byProviderId = {};
    mockProviderModelsState.clearEpoch = 1;
    (mockAppStore as unknown as { emitState: () => void }).emitState();

    await waitFor(() => {
      expect(
        vi
          .mocked(getModelsForProviderForLoadingState)
          .mock.calls.filter(([pid]) => pid === 'auggie'),
      ).toHaveLength(2);
    });
  });

  it('discards a pre-clear response entirely (no local state, no write-through)', async () => {
    // The epoch is captured when the fetch STARTS: a clear that lands
    // mid-flight bumps the state epoch, and the settle-time epoch check
    // drops the stale response before it reaches local component state OR
    // the cache write-through. The epoch is mutated here without an
    // emitState() (no reconnect-reaction refetch) to isolate the settle-time
    // guard itself.
    let resolveFetch!: (result: {
      models: { value: string; label: string; description?: string }[];
    }) => void;
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    render(ModelPicker, {
      props: {
        selectedModel: 'sonnet4.6',
        portal: false,
      },
    });

    await waitFor(() => expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalled());

    // Epoch bumps while the response is in flight; the late settle must be
    // fully discarded.
    mockProviderModelsState.clearEpoch = 1;
    resolveFetch({
      models: [{ value: 'sonnet4.6', label: 'Claude Sonnet 4.6', description: 'Smart model' }],
    });
    await new Promise((r) => setTimeout(r, 50));

    // No cache write-through was dispatched for the stale response…
    expect(
      mockSvelteDispatch.mock.calls.find(
        ([action]) => action?.type === 'providerModels/providerModelsLoaded',
      ),
    ).toBeUndefined();
    // …and the stale rows never reached local state (the trigger label
    // would have resolved from allProviderModels).
    expect(screen.getByRole('button').textContent).not.toContain('Claude Sonnet 4.6');
  });

  it('refetches and discards the stale response when reconnect happens during initial load (empty cache)', async () => {
    // Reconnect DURING initial load: the cache is already empty, so the map
    // never transitions non-empty → empty — only the clear epoch (which
    // increments on every providerModelsCacheCleared) signals the reconnect.
    // The in-flight pre-reconnect response must be discarded and a
    // replacement fetch must start.
    const resolvers: ((result: {
      models: { value: string; label: string; description?: string }[];
    }) => void)[] = [];
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    render(ModelPicker, {
      props: {
        selectedModel: 'sonnet4.6',
        portal: false,
      },
    });

    // First fetch (epoch 0) is in flight against the pre-restart daemon.
    await waitFor(() => expect(resolvers).toHaveLength(1));

    // Backend reconnect: the seeder dispatches providerModelsCacheCleared.
    // The map stays {} (empty→empty) — only the epoch moves.
    mockProviderModelsState.clearEpoch = 1;
    (mockAppStore as unknown as { emitState: () => void }).emitState();

    // A replacement fetch starts despite unchanged provider ids + empty map.
    await waitFor(() => expect(resolvers.length).toBeGreaterThan(1));

    // The stale pre-reconnect response settles late — fully discarded.
    resolvers[0]({
      models: [{ value: 'stale-model', label: 'Stale Model', description: 'Pre-reconnect' }],
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(
      mockSvelteDispatch.mock.calls.find(
        ([action]) => action?.type === 'providerModels/providerModelsLoaded',
      ),
    ).toBeUndefined();
    expect(screen.getByRole('button').textContent).not.toContain('Stale Model');

    // The post-reconnect fetch settles — applied to local state AND written
    // through with the post-clear epoch.
    resolvers[resolvers.length - 1]({
      models: [{ value: 'sonnet4.6', label: 'Claude Sonnet 4.6', description: 'Smart model' }],
    });
    await waitFor(() => {
      const writeThrough = mockSvelteDispatch.mock.calls.find(
        ([action]) => action?.type === 'providerModels/providerModelsLoaded',
      );
      expect(writeThrough).toBeTruthy();
      const [providerId, , epoch] = writeThrough![0].payload as [string, unknown, number];
      expect(providerId).toBe('auggie');
      expect(epoch).toBe(1);
    });
    expect(screen.getByRole('button').textContent).toContain('Claude Sonnet 4.6');
  });

  it('hydrates the agent-provider path (disabled effective provider) from the cache', async () => {
    // Locked/agent picker whose provider (codex) is no longer enabled: the
    // all-provider fetch prunes cached codex rows, so only the per-agent
    // path's own cache hydration can resolve the label while the
    // never-settling revalidation is pending.
    mockProviderModelsState.byProviderId = {
      codex: {
        models: [{ value: 'codex:gpt-5-codex', label: 'GPT-5 Codex', description: 'Smart' }],
        fetchedAt: new Date().toISOString(),
      },
    };
    mockModelState.selectedModel = 'codex:gpt-5-codex';
    enabledProviderIds$.set(['auggie']);
    mockAgentSession$.set({ id: 'agent-1', workspaceId: 'ws-1', provider: 'codex' });
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(() => new Promise(() => {}));

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5-codex',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        portal: false,
      },
    });

    // Past the debounce: the 'auggie' call proves the all-provider fetch ran
    // (it prunes codex from its local map synchronously before fetching), and
    // the 'codex' call proves the agent-provider revalidation still fired.
    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('auggie');
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('codex');
    });
    await new Promise((r) => setTimeout(r, 0));
    // A resolved label + no spinner proves the agent path rendered the cached
    // catalog instead of flipping to loading.
    const button = screen.getByRole('button');
    expect(button.textContent).toContain('GPT-5 Codex');
    expect(button.querySelector('.animate-pulse')).toBeNull();
    expect(button.querySelector('[role="status"]')).toBeNull();

    mockAgentSession$.set(undefined);
  });

  it('writes agent-provider fetch results through to the cache slice', async () => {
    mockModelState.selectedModel = 'codex:gpt-5-codex';
    enabledProviderIds$.set(['auggie']);
    mockAgentSession$.set({ id: 'agent-1', workspaceId: 'ws-1', provider: 'codex' });
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => {
      if (providerId === 'codex') {
        return {
          models: [{ value: 'codex:gpt-5-codex', label: 'GPT-5 Codex', description: 'Smart' }],
        };
      }
      return { models: [] };
    });

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5-codex',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        portal: false,
      },
    });

    await waitFor(() => {
      const writeThrough = mockSvelteDispatch.mock.calls.find(
        ([action]) =>
          action?.type === 'providerModels/providerModelsLoaded' &&
          (action.payload as [string, unknown])[0] === 'codex',
      );
      expect(writeThrough).toBeTruthy();
      const entry = (writeThrough![0].payload as [string, { models: { value: string }[] }])[1];
      expect(entry.models).toEqual([
        { value: 'codex:gpt-5-codex', label: 'GPT-5 Codex', description: 'Smart' },
      ]);
    });

    mockAgentSession$.set(undefined);
  });

  it('writes the silent-fallback retry fetch through to the cache slice', async () => {
    // The selected model's provider (auggie) has no models while another
    // enabled provider does, so the silent-fallback retry
    // (getModelsForProvider) is the path that recovers auggie's models — it
    // must write through like the other fetch paths.
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => {
      if (providerId === 'codex') {
        return {
          models: [{ value: 'codex:gpt-5-codex', label: 'GPT-5 Codex', description: 'Smart' }],
        };
      }
      return { models: [] };
    });
    vi.mocked(getModelsForProvider).mockResolvedValue([
      { value: 'auggie:model-1', label: 'Auggie Model 1', description: 'A model' },
    ]);
    mockModelState.selectedModel = 'auggie:missing-model';
    enabledProviderIds$.set(['auggie', 'codex']);

    render(ModelPicker, {
      props: {
        selectedModel: 'auggie:missing-model',
        silentFallback: true,
        portal: false,
      },
    });

    await waitFor(() => {
      const writeThrough = mockSvelteDispatch.mock.calls.find(
        ([action]) =>
          action?.type === 'providerModels/providerModelsLoaded' &&
          (action.payload as [string, { models: { value: string }[] }])[1].models.some(
            (model) => model.value === 'auggie:model-1',
          ),
      );
      expect(writeThrough).toBeTruthy();
      expect((writeThrough![0].payload as [string, unknown])[0]).toBe('auggie');
    });
  });
});
