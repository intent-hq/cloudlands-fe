import { withLegacyPrincipal } from '../../../../test/fixtures/principal-state';
/**
 * @vitest-environment jsdom
 *
 * New Workspace → Start On at the CompactWorkspaceInitializer level, with the
 * REAL InitialAgentPicker and StartOnPicker rendered: the row shows only with
 * another usable machine on a backend advertising `remoteInitialAgent: 1`,
 * defaults to the backend, follows the per-codebase memory with a fallback,
 * scopes the Model row to the machine, and sends `initialAgent.placement`
 * only for a remote choice.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompactWorkspaceInitializerFormState } from '$store/renderer/slices/workspace-initializer/workspace-initializer-types';
import { createWorkspaceInitializationDispatchAdapter } from './workspace-initialization-dispatch.test-helper';

const mocks = vi.hoisted(() => {
  function writable<T>(initial: T) {
    let value = initial;
    const subs = new Set<(v: T) => void>();
    return {
      subscribe(run: (v: T) => void) {
        subs.add(run);
        run(value);
        return () => subs.delete(run);
      },
      set(v: T) {
        value = v;
        for (const run of subs) run(v);
      },
    };
  }
  const readable = <T>(value: T) => ({
    subscribe(run: (v: T) => void) {
      run(value);
      return () => {};
    },
  });
  return {
    writable,
    readable,
    principalState: {} as Record<string, unknown>,
    remote: {
      labs: true,
      supported: true,
      initialAgentPlacement: true,
      machines: {} as Record<string, unknown>,
    },
    dispatch: vi.fn(),
    goto: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    hydrated$: writable(false),
    selectedModel$: writable(''),
    configuredModels$: writable<Record<string, string>>({}),
    defaultReasoningEffort$: writable(''),
    compactFormState$: writable<unknown>(null),
    lastSubmittedAgent$: writable<unknown>(null),
    initializationOutcome$: writable<
      | Partial<
          import('$store/renderer/slices/workspace-initializer/workspace-initializer-types').WorkspaceInitializationOutcome
        >
      | undefined
    >(undefined),
    agentByRepo: {} as Record<string, unknown>,
    // Never resolves: provider availability stays unknown, so it is never
    // clearing evidence — the provider-models catalog below decides validity.
    getProviderAvailability: vi.fn(() => new Promise(() => {})),
  };
});

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  const { initialState, providerCatalogLoaded, providerCatalogReducer } =
    await import('$store/renderer/slices/provider-catalog/provider-catalog-slice');
  const { MOCK_PROVIDER_CATALOG } =
    await import('../../../../test/fixtures/provider-catalog.fixture');
  const { initialState: userPreferences } =
    await import('$store/renderer/slices/user-preferences/user-preferences-slice');
  const { initialState: connections } =
    await import('$store/renderer/slices/connections/connections-slice');
  const providerCatalog = providerCatalogReducer(
    initialState,
    providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
  );
  return createAppStoreMockModule({
    state: () => ({
      ...mocks.principalState,
      providerCatalog,
      providerSettings: {
        enabledProviders: {},
        // Default rows with the field: the backend switches remote models.
        profiles: {
          defaults: { auggie: { baseProviderId: 'auggie', env: [], remoteCompatible: true } },
          loadStatus: 'success',
        },
      },
      userPreferences: {
        ...userPreferences,
        ...(mocks.principalState.userPreferences as object | undefined),
        labsRemoteAgentsEnabled: mocks.remote.labs,
      },
      connections: {
        ...connections,
        windowBackendId: 'local',
        ...(mocks.principalState.connections as object | undefined),
      },
      remoteMachines: {
        supported: mocks.remote.supported,
        initialAgentPlacement: mocks.remote.initialAgentPlacement,
        machines: mocks.remote.machines,
        localFingerprint: null,
        executorBackends: null,
        pending: {},
        failures: {},
      },
      model: { defaultProviderId: 'auggie' },
      // The auggie catalog KNOWS opus4.6 — the restored override is valid.
      providerModels: {
        byProviderId: {
          auggie: {
            models: ['fable-5', 'opus4.6', 'user-picked-model'].map((value) => ({
              value,
              effortLevels: ['low', 'high'],
            })),
            fetchedAt: '2026-08-15T00:00:00.000Z',
          },
        },
        clearEpoch: 0,
      },
      hardwareConsole: { pttRecording: false, voiceTranscribing: false },
      workspaceCreateProgress: { byProgressId: {} },
    }),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-selectors', () => ({
  selectWorkspaceInitializerAgentForRepo: {
    select: (_state: unknown, repoKey: string) => mocks.agentByRepo[repoKey] ?? null,
  },
  selectWorkspaceInitializerGitAvailability: () => ({
    subscribe(run: (value: boolean) => void) {
      run(true);
      return () => {};
    },
  }),
  selectWorkspaceInitializerHydrated: () => mocks.hydrated$,
  selectCompactWorkspaceInitializerFormState: () => mocks.compactFormState$,
  selectWorkspaceInitializerLastSelectedRepo: () => mocks.readable(null),
  selectWorkspaceInitializerLastSubmittedAgent: () => mocks.lastSubmittedAgent$,
  selectWorkspaceInitializerRecentRepos: () => mocks.readable([]),
  selectWorkspaceInitializerRecentSpecialistIds: () => mocks.readable([]),
  selectWorkspaceInitializerPendingGitHubPrefill: () => mocks.readable(null),
  selectWorkspaceInitializerDefaultParentPath: () => mocks.readable(''),
  selectWorkspaceInitializerDraftAuthority: () =>
    mocks.readable({ restore: undefined, clear: undefined }),
  selectWorkspaceInitializationOutcomeForConsumer: () => mocks.initializationOutcome$,
  selectWorkspaceInitializationResume: { select: () => undefined },
}));

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectAvailableModels: () => mocks.readable([]),
  selectAvailableModelsProviderId: () => mocks.readable(''),
  selectSelectedModel: () => mocks.selectedModel$,
  selectProviderModels: () => mocks.configuredModels$,
  selectDefaultReasoningEffort: () => mocks.defaultReasoningEffort$,
  selectModelEffortLevels: { select: () => undefined },
}));

vi.mock('$store/renderer/slices/provider-settings/provider-settings-selectors', () => ({
  selectActiveProviderId: () => mocks.readable('auggie'),
  selectEnabledProviders: () => mocks.readable({}),
}));

vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: Object.assign(
    () =>
      mocks.readable([
        { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'fable-5' },
      ]),
    {
      select: vi.fn(() => [
        { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'fable-5' },
      ]),
    },
  ),
  selectCustomSpecialistsLoaded: () => mocks.readable(true),
  selectFileSpecialistsLoaded: () => mocks.readable(true),
  selectUserOverrides: { select: vi.fn(() => ({ modelOverrides: {} })) },
  selectEffectiveBehaviorPrompt: { select: vi.fn(() => undefined) },
  selectEffectiveModel: { select: vi.fn(() => undefined) },
  selectEffectiveCodingAgent: { select: vi.fn(() => undefined) },
  selectOrchestratorSpecialist: Object.assign(
    () =>
      mocks.readable({
        id: 'spec-writer',
        name: 'Coordinator',
        description: '',
        role: 'orchestrator',
        teamAgents: ['implementor', 'verifier'],
        icon: 'coordinator',
      }),
    {
      select: vi.fn(() => ({
        id: 'spec-writer',
        name: 'Coordinator',
        description: '',
        role: 'orchestrator',
        teamAgents: ['implementor', 'verifier'],
        icon: 'coordinator',
      })),
    },
  ),
  filterModalPickableSpecialists: (specialists: Array<{ role?: string }>) =>
    specialists.filter((s) => s.role !== 'internal'),
}));

vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: () => mocks.readable(true),
}));

vi.mock('$features/providers/provider-availability.client', () => ({
  getProviderAvailability: mocks.getProviderAvailability,
}));

vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToSettings: vi.fn(),
}));

vi.mock('$features/setup-scripts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$features/setup-scripts')>()),
  SETUP_SCRIPT_TEMPLATES: [],
  getTemplateContent: vi.fn(() => ''),
  chooseDefaultSetupScript: vi.fn(() => ({ content: '', name: 'Custom', source: 'custom' })),
  fetchRepoConfigSetupScript: vi.fn(async () => null),
  fetchGitHubRepoConfigSetupScript: vi.fn(async () => null),
  probeRepoConfigSetupScript: vi.fn(),
  repoIdentityKey: vi.fn((identity: { path: string | null }) => identity.path),
  createRepoConfigProbeScheduler: vi.fn(() => ({
    onSelectionChange: vi.fn(),
    settled: vi.fn(async () => {}),
    dispose: vi.fn(),
  })),
  resolveSetupScriptParam: vi.fn(() => undefined),
  REPO_CONFIG_SCRIPT_NAME: 'Repo config',
}));

vi.mock('$features/setup-scripts/last-used', () => ({
  getLastUsedSetupScript: vi.fn(() => undefined),
  recordLastUsedSetupScript: vi.fn(),
}));

vi.mock('$lib/config/debug', () => ({
  debugConfig: { get: vi.fn(() => false) },
}));

vi.mock('$lib/client', () => ({
  appClient: {
    git: { pull: vi.fn(async () => ({ success: true })) },
    drafts: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    },
    specialists: {
      list: vi.fn(async () => [
        { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'fable-5' },
      ]),
    },
    agents: { setReasoningEffort: vi.fn(async () => ({ ok: true })) },
  },
}));

vi.mock('$lib/client/live/live-prompt-enhancement', () => ({
  enhancePrompt: vi.fn(async (p: string) => ({ enhanced: p })),
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
  workspaceClient: { create: mocks.create, update: mocks.update },
}));

vi.mock('$lib/electron-bridge', () => ({
  isElectron: vi.fn(() => true),
  invoke: vi.fn(async (channel: string) => {
    if (channel === 'system:check-git') {
      return { success: true, data: { available: true, version: '2.44.0' } };
    }
    return { success: true, data: null };
  }),
  listen: vi.fn(async () => () => {}),
  listenSync: vi.fn(() => () => {}),
  emit: vi.fn(async () => {}),
}));

vi.mock('$lib/components/ui/RichTextarea.svelte', async () => ({
  default: (await import('./mocks/MockRichTextarea.svelte')).default,
}));

vi.mock('$lib/components/modals/PullConflictDialog.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('$lib/components/modals/SetupScriptModal.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('$lib/components/workspace/initializer/IssueSuggestions.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
  preloadIssues: vi.fn(),
}));

vi.mock('$lib/components/workspace/initializer/RepoAndBranchPicker.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('$lib/components/chat/AttachmentPreview.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('$features/agent/components/auggie-avatar/AuggieAvatar.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

// The REAL InitialAgentPicker is rendered; only its inner ModelPicker and
// dropdown are mocked (same boundaries as InitialAgentPicker.test.ts).
vi.mock('$lib/components/chat/input/ModelPicker.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockModelPicker.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

import CompactWorkspaceInitializer from '../CompactWorkspaceInitializer.svelte';
import { m } from '$shared/paraglide/messages.js';

import { warmImport } from '../../../../test/warm-import';

const PREFILL_KEY = 'workspace-prefill';

function mockCreateSuccess() {
  mocks.create.mockResolvedValue({
    ok: true,
    data: {
      workspace: {
        id: 'ws-created',
        title: 'Created workspace',
        path: '/tmp/ws-created',
        repositoryPath: '/tmp/test-repo',
        worktreePath: '/tmp/ws-created',
        status: 'Active',
      },
      initialAgent: { id: 'agent-created' },
    },
  });
}

function submittedInitialAgent() {
  expect(mocks.create).toHaveBeenCalledTimes(1);
  return mocks.create.mock.calls[0][0].initialAgent;
}

warmImport(() => import('./mocks/MockRichTextarea.svelte'));
warmImport(() => import('../initializer/__tests__/mocks/MockComponent.svelte'));
warmImport(() => import('../initializer/__tests__/mocks/MockModelPicker.svelte'));

const SAVED_AGENT_STATE: CompactWorkspaceInitializerFormState = {
  repoPath: '',
  repoType: 'local',
  githubUrl: '',
  branch: '',
  isNewRepo: false,
  isValidPath: false,
  scope: '',
  selectedSpecialist: 'spec-writer',
  selectedModel: 'opus4.6',
  modelWasOverridden: true,
  isTeamMode: true,
  selectedProvider: 'auggie',
};

const MACHINE = {
  id: 'node-mac',
  name: 'Mac mini',
  platform: { os: 'macos', arch: 'aarch64' },
  hosts: [],
  port: 7443,
  fingerprint: 'fp',
  state: 'connected',
  runningAgents: 0,
  addedAt: '2026-11-01T00:00:00Z',
  observedAt: new Date().toISOString(),
  capabilities: {
    providers: [{ id: 'auggie', status: 'ready', models: ['fable-5', 'opus4.6'] }],
  },
};
const REPO_KEY = 'local:/tmp/test-repo';
const AGENT: CompactWorkspaceInitializerFormState = SAVED_AGENT_STATE;

async function createWith(remembered?: Partial<CompactWorkspaceInitializerFormState>) {
  mockCreateSuccess();
  if (remembered) mocks.agentByRepo[REPO_KEY] = { ...AGENT, ...remembered };
  mocks.compactFormState$.set(AGENT);
  mocks.hydrated$.set(true);
  sessionStorage.setItem(
    PREFILL_KEY,
    JSON.stringify({
      repoPath: '/tmp/test-repo',
      branch: 'main',
      prompt: 'Build',
      autoCreate: true,
    }),
  );
  const view = render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
  return view;
}

async function submit(view: Awaited<ReturnType<typeof createWith>>) {
  await view.component.applyPrefill();
  await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-created'));
  return submittedInitialAgent();
}

describe('New Workspace → Start On', () => {
  beforeEach(() => {
    mocks.principalState = withLegacyPrincipal({});
    vi.clearAllMocks();
    mocks.dispatch.mockImplementation(
      createWorkspaceInitializationDispatchAdapter({
        create: mocks.create,
        setOutcome: (outcome) => mocks.initializationOutcome$.set(outcome),
      }),
    );
    mocks.initializationOutcome$.set(undefined);
    sessionStorage.clear();
    mocks.hydrated$.set(false);
    mocks.compactFormState$.set(null);
    mocks.lastSubmittedAgent$.set(null);
    mocks.agentByRepo = {};
    mocks.remote.labs = true;
    mocks.remote.supported = true;
    mocks.remote.initialAgentPlacement = true;
    mocks.remote.machines = { [MACHINE.id]: MACHINE };
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it.each([
    ['no machine is available', () => (mocks.remote.machines = {})],
    [
      'the only machine is unreachable',
      () => (mocks.remote.machines = { [MACHINE.id]: { ...MACHINE, state: 'unreachable' } }),
    ],
    ['the Labs flag is off', () => (mocks.remote.labs = false)],
    ['the backend predates remoteInitialAgent', () => (mocks.remote.initialAgentPlacement = false)],
  ])('is hidden and sends no placement when %s', async (_case, arrange) => {
    arrange();
    const view = await createWith({ startOnMachineId: MACHINE.id });
    await waitFor(() =>
      expect(screen.getAllByTestId('picker-selected')[0].textContent).toBe('opus4.6'),
    );
    expect(screen.queryByTestId('start-on-picker')).toBeNull();
    expect(screen.getByTestId('picker-machine').textContent).toBe('');
    expect(await submit(view)).not.toHaveProperty('placement');
  });

  it('shows after Model, defaults to the backend and sends no placement', async () => {
    const view = await createWith();
    const row = await screen.findByTestId('start-on-picker');
    expect(row.textContent).toContain(m.workspace_initialAgentPicker_startOn_label());
    expect(row.textContent).toContain(m.layout_daemonStatus_localConnection_label());
    const picker = screen.getByTestId('initial-agent-picker');
    const model = screen.getByTestId('mock-model-picker');
    expect(model.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(picker.contains(row)).toBe(true);
    expect(await submit(view)).not.toHaveProperty('placement');
  });

  it('restores the codebase’s machine, scopes the Model row and sends the placement', async () => {
    const view = await createWith({ startOnMachineId: MACHINE.id });
    await waitFor(() => expect(screen.getByTestId('picker-machine').textContent).toBe('node-mac'));
    expect(screen.getByTestId('start-on-picker').textContent).toContain('Mac mini');
    expect(await submit(view)).toMatchObject({
      placement: { target: 'remote', checkout: 'isolated', nodeId: 'node-mac' },
      model: 'opus4.6',
      provider: 'auggie',
    });
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workspaceInitializer/setAgentForRepo' }),
    );
    const remembered = mocks.dispatch.mock.calls
      .map(([action]) => action)
      .find((action) => action?.type === 'workspaceInitializer/setAgentForRepo');
    expect(remembered.payload).toEqual([
      REPO_KEY,
      expect.objectContaining({ startOnMachineId: 'node-mac' }),
    ]);
  });

  it('falls back to the backend when the remembered machine is gone', async () => {
    const view = await createWith({ startOnMachineId: 'node-removed' });
    await screen.findByTestId('start-on-picker');
    expect(screen.getByTestId('picker-machine').textContent).toBe('');
    expect(await submit(view)).not.toHaveProperty('placement');
  });

  it('falls back to a model the chosen machine can run', async () => {
    mocks.remote.machines = {
      [MACHINE.id]: {
        ...MACHINE,
        capabilities: { providers: [{ id: 'auggie', status: 'ready', models: ['fable-5'] }] },
      },
    };
    const view = await createWith({ startOnMachineId: MACHINE.id });
    await waitFor(() =>
      expect(screen.getAllByTestId('picker-selected')[0].textContent).toBe('fable-5'),
    );
    expect(await submit(view)).toMatchObject({
      placement: { target: 'remote', checkout: 'isolated', nodeId: 'node-mac' },
      model: 'fable-5',
      provider: 'auggie',
    });
  });

  it('falls back when the inherited model is one the chosen machine can’t run', async () => {
    // No override: the specialist's model (fable-5) is inherited, and the
    // daemon resolves it before remote admission, so it must be checked too.
    mocks.remote.machines = {
      [MACHINE.id]: {
        ...MACHINE,
        capabilities: { providers: [{ id: 'auggie', status: 'ready', models: ['opus4.6'] }] },
      },
    };
    const view = await createWith({
      startOnMachineId: MACHINE.id,
      selectedModel: undefined,
      modelWasOverridden: false,
    });
    await waitFor(() => expect(screen.getByTestId('picker-machine').textContent).toBe('node-mac'));
    expect(screen.getByTestId('picker-default').textContent).toBe('fable-5');
    expect(await submit(view)).toMatchObject({
      placement: { target: 'remote', checkout: 'isolated', nodeId: 'node-mac' },
      model: 'opus4.6',
      provider: 'auggie',
    });
  });

  it('keeps an inherited model the chosen machine can run', async () => {
    const view = await createWith({
      startOnMachineId: MACHINE.id,
      selectedModel: undefined,
      modelWasOverridden: false,
    });
    await waitFor(() => expect(screen.getByTestId('picker-machine').textContent).toBe('node-mac'));
    const agent = await submit(view);
    expect(agent).toMatchObject({ placement: { nodeId: 'node-mac' } });
    expect(agent.model).toBeUndefined();
  });

  it('keeps a new repository on the backend: a remote agent needs a commit', async () => {
    mocks.agentByRepo['local:/tmp/new-repo'] = { ...AGENT, startOnMachineId: MACHINE.id };
    mocks.compactFormState$.set({
      ...AGENT,
      repoPath: '/tmp/new-repo',
      isNewRepo: true,
      isValidPath: true,
      startOnMachineId: MACHINE.id,
    });
    mocks.hydrated$.set(true);
    render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
    const row = await screen.findByTestId('start-on-picker');
    await waitFor(() =>
      expect(row.querySelector('[data-testid="start-on-locked-reason"]')).not.toBeNull(),
    );
    expect(row.querySelector('button')?.disabled).toBe(true);
    expect(screen.getByTestId('picker-machine').textContent).toBe('');
  });

  it('keeps the first agent on the backend while files are attached', async () => {
    const view = await createWith({ startOnMachineId: MACHINE.id });
    await waitFor(() => expect(screen.getByTestId('picker-machine').textContent).toBe('node-mac'));
    const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
    await fireEvent.drop(view.container.querySelector<HTMLElement>('[role="region"]')!, {
      dataTransfer: {
        types: ['Files'],
        files: [file],
        items: [
          { kind: 'file', getAsFile: () => file, webkitGetAsEntry: () => ({ isDirectory: false }) },
        ],
      },
    });
    const row = screen.getByTestId('start-on-picker');
    await waitFor(() =>
      expect(row.querySelector('[data-testid="start-on-locked-reason"]')).not.toBeNull(),
    );
    expect(row.querySelector('button')?.disabled).toBe(true);
    expect(screen.getByTestId('picker-machine').textContent).toBe('');
  });

  it('lists unreachable and revoked machines disabled with a reason', async () => {
    mocks.remote.machines = {
      [MACHINE.id]: MACHINE,
      'node-gone': { ...MACHINE, id: 'node-gone', name: 'Gone box', state: 'unreachable' },
    };
    await createWith();
    const trigger = (await screen.findByTestId('start-on-picker')).querySelector('button')!;
    await fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
    await fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
    await fireEvent.click(trigger);
    const options = await screen.findAllByTestId('start-on-option');
    const gone = options.find((option) => option.dataset.machineId === 'node-gone')!;
    expect(gone.getAttribute('aria-disabled')).toBe('true');
    expect(gone.textContent).toContain(m.remoteMachines_state_unreachable_label());
    expect(options[0].dataset.machineId).toBe('');
  });
});
