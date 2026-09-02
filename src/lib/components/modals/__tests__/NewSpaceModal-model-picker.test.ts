/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const readable = <T>(value: T) => ({
    subscribe(run: (next: T) => void) {
      run(value);
      return () => {};
    },
  });
  const models = Array.from({ length: 12 }, (_, index) => ({
    value: `gpt5.${index + 1}`,
    label: `GPT 5.${index + 1}`,
    description: index === 11 ? 'Last model' : `Model ${index + 1}`,
    effortLevels: index === 5 ? ['low', 'medium', 'high'] : undefined,
  }));
  return { readable, models, dispatch: vi.fn(), onClose: vi.fn() };
});

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
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
      providerSettings: { activeProviderId: 'auggie', enabledProviders: { auggie: true } },
      providerModels: { byProviderId: {}, clearEpoch: 0 },
      hardwareConsole: { pttRecording: false, voiceTranscribing: false },
    }),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-selectors', () => ({
  selectWorkspaceInitializerHydrated: () => mocks.readable(true),
  selectCompactWorkspaceInitializerFormState: () => mocks.readable(null),
  selectWorkspaceInitializerLastSelectedRepo: () => mocks.readable(null),
  selectWorkspaceInitializerLastSubmittedAgent: () => mocks.readable(null),
  selectWorkspaceInitializerRecentRepos: () => mocks.readable([]),
  selectWorkspaceInitializerPendingGitHubPrefill: () => mocks.readable(null),
}));

vi.mock('$store/renderer/slices/provider-settings/provider-settings-selectors', () => ({
  selectActiveProviderId: () => mocks.readable('auggie'),
  selectEnabledProviderIds: () => mocks.readable(['auggie']),
  selectAvailableEnabledProviderIds: () => mocks.readable(['auggie']),
}));

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectSelectedModel: () => mocks.readable(undefined),
  selectAvailableModels: () => mocks.readable(mocks.models),
  selectAvailableModelsProviderId: () => mocks.readable('auggie'),
  selectModelFallbackInfo: () => mocks.readable(null),
  selectModelPickerCollapsedGroups: () => mocks.readable([]),
  selectIsLoadingModels: () => mocks.readable(false),
  selectLoadError: () => mocks.readable(null),
  selectAllProviderWarnings: () => mocks.readable({}),
  selectAllProviderStaleFlags: () => mocks.readable({}),
  selectModelEffortLevels: {
    select: (_state: unknown, modelId: string | undefined) =>
      mocks.models.find((model) => model.value === modelId)?.effortLevels,
  },
  selectAgentModelEffortLevels: Object.assign(() => mocks.readable(undefined), {
    select: () => undefined,
    withStore: () => () => mocks.readable(undefined),
  }),
}));

vi.mock('$store/renderer/slices/model/model-utils', () => ({
  getModelsForProvider: vi.fn(async () => mocks.models),
  getModelsForProviderForLoadingState: vi.fn(async () => ({ models: mocks.models })),
}));

vi.mock('$store/renderer/slices/agent-availability/agent-availability-selectors', () => ({
  selectHasCheckedOnce: () => mocks.readable(true),
}));
vi.mock('$store/renderer/slices/daemon-health/daemon-health-selectors', () => ({
  selectDaemonHealth: () => mocks.readable('healthy'),
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => {
  const selectAgentSession = Object.assign(() => mocks.readable(undefined), {
    select: () => undefined,
    withStore: () => () => mocks.readable(undefined),
  });
  const selectAgentReasoningEffort = Object.assign(() => mocks.readable(undefined), {
    select: () => undefined,
    withStore: () => () => mocks.readable(undefined),
  });
  return { selectAgentSession, selectAgentReasoningEffort };
});

vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: Object.assign(
    () =>
      mocks.readable([
        { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'gpt5.5' },
      ]),
    { select: () => [] },
  ),
  selectCustomSpecialistsLoaded: () => mocks.readable(true),
  selectFileSpecialistsLoaded: () => mocks.readable(true),
  selectUserOverrides: () => mocks.readable({ modelOverrides: {} }),
  selectEffectiveBehaviorPrompt: { select: () => undefined },
  filterPickableSpecialists: (specialists: unknown[]) => specialists,
  selectOrchestratorSpecialist: Object.assign(
    () =>
      mocks.readable({
        id: 'spec-writer',
        name: 'Coordinator',
        description: '',
        role: 'orchestrator',
      }),
    {
      select: () => ({
        id: 'spec-writer',
        name: 'Coordinator',
        description: '',
        role: 'orchestrator',
      }),
    },
  ),
  filterModalPickableSpecialists: (specialists: Array<{ role?: string }>) =>
    specialists.filter((s) => s.role !== 'internal'),
}));

vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: () => mocks.readable(true),
}));
vi.mock('$features/providers/provider-availability.client', () => ({
  getProviderAvailability: vi.fn(async () => ({
    providers: { auggie: { available: true } },
  })),
}));

vi.mock('$lib/client', () => ({
  appClient: {
    specialists: {
      list: vi.fn(async () => [
        { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'gpt5.5' },
      ]),
    },
    git: { pull: vi.fn(async () => ({ success: true })) },
  },
}));
vi.mock('$features/agent/agent.client', () => ({
  agentClient: { setModel: vi.fn(async () => ({ ok: true, data: { success: true } })) },
}));
vi.mock('$features/agent/browser', () => ({}));
vi.mock('$lib/utils/workspace-navigation', () => ({ navigateToSettings: vi.fn() }));
vi.mock('svelte-sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));

vi.mock('$features/setup-scripts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$features/setup-scripts')>()),
  SETUP_SCRIPT_TEMPLATES: [],
  getTemplateContent: vi.fn(() => ''),
  chooseDefaultSetupScript: vi.fn(() => ({ content: '', name: 'Custom', source: 'custom' })),
  createRepoConfigProbeScheduler: vi.fn(() => ({
    onSelectionChange: vi.fn(),
    settled: vi.fn(async () => {}),
    dispose: vi.fn(),
  })),
  resolveSetupScriptParam: vi.fn(() => undefined),
  REPO_CONFIG_SCRIPT_NAME: 'Repo config',
}));
vi.mock('$lib/config/debug', () => ({ debugConfig: { get: vi.fn(() => false) } }));
vi.mock('$lib/client/live/live-prompt-enhancement', () => ({
  enhancePrompt: vi.fn(async (prompt: string) => ({ enhanced: prompt })),
  isEnhancePromptAvailable: vi.fn(() => false),
  EnhancePromptUnavailableError: class extends Error {},
}));
vi.mock('$lib/utils/workspace-validation', () => ({
  getGitErrorMessage: (message: string) => message,
  parseGitHubUrl: vi.fn(() => null),
  validateBranchName: vi.fn(() => ({ valid: true })),
  validateInitialPrompt: vi.fn(() => ({ valid: true })),
  validateRepoPath: vi.fn(async () => ({ valid: true })),
}));
vi.mock('$store/renderer/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { create: vi.fn(), update: vi.fn() },
}));
vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(async (channel: string) =>
    channel === 'system:check-git'
      ? { success: true, data: { available: true, version: '2.44.0' } }
      : { success: true, data: null },
  ),
}));
vi.mock('$lib/components/workspace/initializer/new-workspace-draft', () => ({
  restoreNewWorkspaceDraft: vi.fn(async () => ({ status: 'empty' })),
  createNewWorkspaceDraftSaver: vi.fn(() => ({ schedule: vi.fn(), flush: vi.fn() })),
  clearNewWorkspaceDraft: vi.fn(),
}));

vi.mock('$lib/components/ui/RichTextarea.svelte', async () => ({
  default: (await import('../../workspace/__tests__/mocks/MockRichTextarea.svelte')).default,
}));
vi.mock('$lib/components/modals/PullConflictDialog.svelte', async () => ({
  default: (await import('../../workspace/initializer/__tests__/mocks/MockComponent.svelte'))
    .default,
}));
vi.mock('$lib/components/modals/SetupScriptModal.svelte', async () => ({
  default: (await import('../../workspace/initializer/__tests__/mocks/MockComponent.svelte'))
    .default,
}));
vi.mock('$lib/components/workspace/initializer/IssueSuggestions.svelte', async () => ({
  default: (await import('../../workspace/initializer/__tests__/mocks/MockComponent.svelte'))
    .default,
  preloadIssues: vi.fn(),
}));
vi.mock('$lib/components/workspace/initializer/RepoAndBranchPicker.svelte', async () => ({
  default: (await import('../../workspace/initializer/__tests__/mocks/MockComponent.svelte'))
    .default,
}));
vi.mock('$lib/components/chat/AttachmentPreview.svelte', async () => ({
  default: (await import('../../workspace/initializer/__tests__/mocks/MockComponent.svelte'))
    .default,
}));
vi.mock('$features/agent/components/agent-avatar/AgentAvatar.svelte', async () => ({
  default: (await import('../../workspace/initializer/__tests__/mocks/MockComponent.svelte'))
    .default,
}));
vi.mock('$features/agent/components/AgentProviderIcon.svelte', async () => ({
  default: (await import('../../workspace/initializer/__tests__/mocks/MockComponent.svelte'))
    .default,
  hasProviderIcon: () => false,
}));
vi.mock('$lib/components/ui/dropdown-menu.svelte', async () => ({
  default: (await import('../../workspace/initializer/__tests__/mocks/MockDropdownMenu.svelte'))
    .default,
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

import NewSpaceModal from '../NewSpaceModal.svelte';
import { setCompactWorkspaceInitializerFormState } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';

function persistedStates() {
  return mocks.dispatch.mock.calls
    .map(([action]) => action)
    .filter((action) => action?.type === setCompactWorkspaceInitializerFormState.type)
    .map((action) => action.payload[0]);
}

function modeCard(name: RegExp) {
  return screen.getByRole('button', { name });
}

function pickerTrigger(card: HTMLElement) {
  const trigger = card.querySelector('button[aria-haspopup="listbox"]');
  expect(trigger).toBeTruthy();
  return trigger as HTMLButtonElement;
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

function stubGeometry(dialog: HTMLElement, trigger: HTMLButtonElement, triggerRect: DOMRect) {
  dialog.getBoundingClientRect = vi.fn(() => rect(80, 60, 840, 560));
  trigger.getBoundingClientRect = vi.fn(() => triggerRect);
  trigger.parentElement!.getBoundingClientRect = vi.fn(() => triggerRect);
}

describe('NewSpaceModal model-picker composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it('selects models in both modes without bubbling, closing, or losing persisted state', async () => {
    render(NewSpaceModal, { props: { open: true, onClose: mocks.onClose } });
    const dialog = await screen.findByRole('dialog', { name: 'New Workspace' });
    const team = modeCard(/Agent orchestration/i);
    const single = modeCard(/Single agent/i);

    const teamTrigger = pickerTrigger(team);
    stubGeometry(dialog, teamTrigger, rect(140, 520, 150, 28));
    await fireEvent.click(teamTrigger);
    const teamListbox = await within(dialog).findByRole('listbox');
    expect(dialog.contains(teamListbox)).toBe(true);
    expect(teamListbox.dataset.side).toBe('top');
    expect(teamListbox.style.maxHeight).toBe('360px');
    expect(parseFloat(teamListbox.style.maxWidth)).toBeLessThanOrEqual(824);
    expect(
      await within(teamListbox).findByRole('option', { name: /^GPT 5\.1 Model 1/ }),
    ).toBeTruthy();
    expect(within(teamListbox).getByRole('option', { name: /^GPT 5\.12 Last model/ })).toBeTruthy();
    await fireEvent.click(
      await within(teamListbox).findByRole('option', { name: /GPT 5\.6/ }, { timeout: 5000 }),
    );

    await waitFor(() => {
      expect(pickerTrigger(team).textContent).toContain('GPT 5.6');
      expect(persistedStates().at(-1)).toMatchObject({
        selectedModel: 'gpt5.6',
        modelWasOverridden: true,
        selectedProvider: 'auggie',
        isTeamMode: true,
      });
    });

    await fireEvent.click(pickerTrigger(team));
    const reasoningTrigger = await within(dialog).findByTestId('effort-picker-trigger');
    await fireEvent.click(reasoningTrigger);
    const reasoningPopup = document.getElementById(
      reasoningTrigger.getAttribute('aria-controls')!,
    )!;
    const reasoningListbox = within(reasoningPopup).getByRole('listbox');
    await fireEvent.pointerUp(within(reasoningListbox).getByRole('option', { name: 'High' }), {
      pointerType: 'mouse',
    });
    await waitFor(() => {
      expect(persistedStates().at(-1)).toMatchObject({ selectedReasoningEffort: 'high' });
      const updatedTeamTrigger = pickerTrigger(team);
      expect(within(updatedTeamTrigger).getByLabelText('GPT 5.6 · High')).toBeTruthy();
      expect(updatedTeamTrigger.textContent).not.toContain('High');
      const effortGauge = within(updatedTeamTrigger).getByTestId('model-reasoning-effort-gauge');
      expect(effortGauge.dataset.gaugeValue).toBe('2');
      expect(effortGauge.dataset.gaugeSize).toBe('compact');
    });
    await fireEvent.click(pickerTrigger(team));
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(team.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(
      persistedStates().filter(
        (state) =>
          state.selectedModel === 'gpt5.6' &&
          state.isTeamMode === true &&
          state.selectedReasoningEffort === undefined,
      ),
    ).toHaveLength(1);
    expect(mocks.onClose).not.toHaveBeenCalled();

    await fireEvent.click(single);
    expect(single.getAttribute('aria-pressed')).toBe('true');
    const singleTrigger = pickerTrigger(single);
    stubGeometry(dialog, singleTrigger, rect(600, 120, 150, 28));
    await fireEvent.click(singleTrigger);
    const singleListbox = await within(dialog).findByRole('listbox');
    expect(singleListbox.dataset.side).toBe('bottom');
    expect(singleListbox.style.maxHeight).toBe('360px');
    await fireEvent.click(
      await within(singleListbox).findByRole('option', { name: /GPT 5\.5/ }, { timeout: 5000 }),
    );

    await waitFor(() => {
      expect(pickerTrigger(single).textContent).toContain('GPT 5.5');
      expect(persistedStates().at(-1)).toMatchObject({
        selectedModel: 'gpt5.5',
        modelWasOverridden: true,
        selectedProvider: 'auggie',
        isTeamMode: false,
      });
    });
    expect(single.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'New Workspace' })).toBe(dialog);
    expect(
      persistedStates().filter(
        (state) => state.selectedModel === 'gpt5.5' && state.isTeamMode === false,
      ),
    ).toHaveLength(1);
    expect(mocks.onClose).not.toHaveBeenCalled();
  });

  it('keeps keyboard and dismissal behavior inside the open dialog', async () => {
    render(NewSpaceModal, { props: { open: true, onClose: mocks.onClose } });
    const dialog = await screen.findByRole('dialog', { name: 'New Workspace' });
    const team = modeCard(/Agent orchestration/i);
    const trigger = pickerTrigger(team);

    await fireEvent.click(trigger);
    await within(dialog).findByRole('option', { name: /GPT 5\.6/ }, { timeout: 5000 });
    const search = await within(dialog).findByRole('searchbox', { name: 'Search options' });
    await fireEvent.input(search, { target: { value: 'GPT 5.6' } });
    await fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(trigger.textContent).toContain('GPT 5.6'));
    expect(team.getAttribute('aria-pressed')).toBe('true');

    await fireEvent.click(trigger);
    expect(await within(dialog).findByRole('listbox')).toBeTruthy();
    await fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(screen.getByRole('dialog', { name: 'New Workspace' })).toBe(dialog);

    await fireEvent.click(trigger);
    const reopenedSearch = await within(dialog).findByRole('searchbox', { name: 'Search options' });
    await fireEvent.keyDown(reopenedSearch, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole('dialog', { name: 'New Workspace' })).toBe(dialog);
    expect(mocks.onClose).not.toHaveBeenCalled();
  });

  it('dismisses nested reasoning before the modal-aware model picker on Escape', async () => {
    render(NewSpaceModal, { props: { open: true, onClose: mocks.onClose } });
    const dialog = await screen.findByRole('dialog', { name: 'New Workspace' });
    const team = modeCard(/Agent orchestration/i);
    const modelTrigger = pickerTrigger(team);

    await fireEvent.click(modelTrigger);
    const modelListbox = await within(dialog).findByRole('listbox');
    await fireEvent.click(
      await within(modelListbox).findByRole('option', { name: /GPT 5\.6/ }, { timeout: 5000 }),
    );
    await waitFor(() => expect(modelTrigger.textContent).toContain('GPT 5.6'));

    await fireEvent.click(modelTrigger);
    const reasoningTrigger = await within(dialog).findByTestId('effort-picker-trigger');
    reasoningTrigger.focus();
    await fireEvent.keyDown(reasoningTrigger, { key: 'Enter' });
    await waitFor(() => expect(screen.getAllByRole('listbox')).toHaveLength(2));
    const persistedCount = persistedStates().length;

    await fireEvent.keyDown(reasoningTrigger, { key: 'ArrowDown' });
    expect(screen.getAllByRole('listbox')).toHaveLength(2);
    await fireEvent.keyDown(reasoningTrigger, { key: 'Escape' });

    await waitFor(() => {
      expect(within(dialog).getAllByRole('listbox')).toHaveLength(1);
      expect(reasoningTrigger.getAttribute('aria-expanded')).toBe('false');
    });
    expect(document.activeElement).toBe(reasoningTrigger);
    expect(persistedStates()).toHaveLength(persistedCount);
    expect(mocks.onClose).not.toHaveBeenCalled();

    await fireEvent.keyDown(reasoningTrigger, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(document.activeElement).toBe(modelTrigger);
    expect(screen.getByRole('dialog', { name: 'New Workspace' })).toBe(dialog);
    expect(persistedStates()).toHaveLength(persistedCount);
    expect(mocks.onClose).not.toHaveBeenCalled();
  });

  it('affirms model picker bounds and options in every required visual state', async () => {
    for (const { theme, width, zoom, reducedMotion } of [
      { theme: 'light', width: 1024, zoom: 1, reducedMotion: false },
      { theme: 'dark', width: 520, zoom: 2, reducedMotion: true },
    ]) {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 420 });
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: (query: string) => ({
          matches: query.includes('prefers-reduced-motion') && reducedMotion,
          addEventListener() {},
          removeEventListener() {},
        }),
      });
      const view = render(NewSpaceModal, { props: { open: true, onClose: mocks.onClose } });
      view.container.style.zoom = String(zoom);
      const dialog = await screen.findByRole('dialog', { name: 'New Workspace' });
      dialog.getBoundingClientRect = vi.fn(() => rect(16, 16, 488, 388));
      const trigger = pickerTrigger(modeCard(/Agent orchestration/i));
      trigger.getBoundingClientRect = vi.fn(() => rect(210, 330, 150, 28));
      trigger.parentElement!.getBoundingClientRect = vi.fn(() => rect(210, 330, 150, 28));

      await fireEvent.mouseEnter(trigger);
      trigger.focus();
      await fireEvent.click(trigger);
      const listbox = await within(dialog).findByRole('listbox');
      expect(listbox.dataset.side).toBe('top');
      expect(parseFloat(listbox.style.maxHeight)).toBeLessThanOrEqual(306);
      expect(parseFloat(listbox.style.maxWidth)).toBeLessThanOrEqual(472);
      const scroller = listbox.querySelector('[data-scroll-container]') as HTMLElement;
      expect(scroller.className).toContain('overflow-y-auto');

      const search = within(listbox).getByRole('searchbox', { name: 'Search options' });
      await within(listbox).findByRole('option', { name: /^GPT 5\.12 Last model/ });
      await fireEvent.keyDown(search, { key: 'End' });
      expect(
        within(listbox).getByRole('option', { name: /^GPT 5\.12 Last model/ }).dataset.highlighted,
      ).toBe('true');
      await fireEvent.keyDown(search, { key: 'Home' });
      expect(
        within(listbox).getByRole('option', { name: /^GPT 5\.1 Model 1/ }).dataset.highlighted,
      ).toBe('true');
      view.unmount();
    }
  });
});
