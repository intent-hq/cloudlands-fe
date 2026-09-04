/**
 * @vitest-environment jsdom
 *
 * Regression test: `workspace.create` must NOT send a client-minted
 * `initialAgent.agentId` — the daemon assigns the id and returns it on the
 * create result. This supersedes the earlier fresh-id-per-attempt fix
 * (STAB-143): with no client id on the wire, a failed create can no longer
 * poison retries with a duplicate agent_session.id.
 */
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const readable = <T>(getter: () => T) => ({
    subscribe(run: (value: T) => void) {
      run(getter());
      return () => {};
    },
  });
  function writable<T>(initial: T) {
    let value = initial;
    const subscribers = new Set<(value: T) => void>();
    return {
      subscribe(run: (value: T) => void) {
        subscribers.add(run);
        run(value);
        return () => subscribers.delete(run);
      },
      set(next: T) {
        value = next;
        for (const run of subscribers) run(next);
      },
    };
  }
  return {
    readable,
    dispatch: vi.fn(),
    goto: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    pull: vi.fn(async () => ({ success: true })),
    setReasoningEffort: vi.fn(),
    hydrated$: writable(false),
    compactFormState$: writable<{
      selectedModel?: string;
      modelWasOverridden?: boolean;
      selectedReasoningEffort?: string;
      skipIsolation?: boolean;
    } | null>(null),
  };
});

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ workspaceCreateProgress: { byProgressId: {} } }),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-selectors', () => ({
  selectWorkspaceInitializerHydrated: () => mocks.hydrated$,
  selectCompactWorkspaceInitializerFormState: () => mocks.compactFormState$,
  selectWorkspaceInitializerLastSelectedRepo: () => mocks.readable(() => null),
  selectWorkspaceInitializerLastSubmittedAgent: () => mocks.readable(() => null),
  selectWorkspaceInitializerRecentRepos: () => mocks.readable(() => []),
  selectWorkspaceInitializerPendingGitHubPrefill: () => mocks.readable(() => null),
  selectWorkspaceInitializerDefaultParentPath: () => mocks.readable(() => ''),
}));

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectAvailableModels: () => mocks.readable(() => []),
  selectSelectedModel: () => mocks.readable(() => undefined),
}));

vi.mock('$store/renderer/slices/provider-settings/provider-settings-selectors', () => ({
  selectActiveProviderId: () => mocks.readable(() => 'auggie'),
}));

vi.mock('$store/renderer/slices/hardware-console/hardware-console-selectors', () => ({
  selectPttRecording: () => mocks.readable(() => false),
  selectVoiceTranscribing: () => mocks.readable(() => false),
}));

vi.mock('$store/renderer/slices/voice-settings/voice-settings-selectors', () => ({
  selectEffectiveVoiceEngine: () => mocks.readable(() => 'os'),
}));

vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: Object.assign(() => mocks.readable(() => []), {
    select: vi.fn(() => []),
  }),
  selectEffectiveBehaviorPrompt: { select: vi.fn(() => undefined) },
  selectEffectiveModel: { select: vi.fn(() => undefined) },
  selectEffectiveCodingAgent: { select: vi.fn(() => undefined) },
  selectUserOverrides: { select: vi.fn(() => ({ modelOverrides: {} })) },
  selectOrchestratorSpecialist: Object.assign(
    () =>
      mocks.readable(() => ({
        id: 'spec-writer',
        name: 'Coordinator',
        description: '',
        role: 'orchestrator',
      })),
    {
      select: vi.fn(() => ({
        id: 'spec-writer',
        name: 'Coordinator',
        description: '',
        role: 'orchestrator',
      })),
    },
  ),
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

vi.mock('$lib/config/debug', () => ({
  debugConfig: { get: vi.fn(() => false) },
}));

vi.mock('$lib/client', () => ({
  appClient: {
    agents: { setReasoningEffort: mocks.setReasoningEffort },
    git: { pull: mocks.pull },
    drafts: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    },
  },
}));

vi.mock('$lib/client/live/live-prompt-enhancement', () => ({
  enhancePrompt: vi.fn(async (p: string) => ({ enhanced: p })),
  isEnhancePromptAvailable: vi.fn(() => true),
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

// The component gates git-dependent paths on `window.electronAPI` (provided by
// test-setup) and `invoke('system:check-git')`, which must report git present
// for the form to become valid.
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

vi.mock('$lib/components/workspace/initializer/InitialAgentPicker.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('$lib/components/workspace/initializer/IssueSuggestions.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
  preloadIssues: vi.fn(),
}));

vi.mock('$lib/components/workspace/initializer/RepoAndBranchPicker.svelte', async () => ({
  default: (await import('./mocks/MockRepoAndBranchPicker.svelte')).default,
}));

vi.mock('$lib/components/chat/AttachmentPreview.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

import CompactWorkspaceInitializer from '../CompactWorkspaceInitializer.svelte';
import { warmImport } from '../../../../test/warm-import';

const PREFILL_KEY = 'workspace-prefill';

function seedAutoCreatePrefill() {
  sessionStorage.setItem(
    PREFILL_KEY,
    JSON.stringify({
      repoPath: '/tmp/test-repo',
      branch: 'main',
      prompt: 'Build the thing',
      autoCreate: true,
    }),
  );
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('./mocks/MockRichTextarea.svelte'));
warmImport(() => import('../initializer/__tests__/mocks/MockComponent.svelte'));

describe('CompactWorkspaceInitializer omits client agent ID on create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.hydrated$.set(false);
    mocks.compactFormState$.set(null);
    mocks.setReasoningEffort.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it('never sends initialAgent.agentId, including on the retry after a failed create', async () => {
    mocks.create.mockRejectedValue(new Error('daemon rejected create'));

    seedAutoCreatePrefill();
    const { component } = render(CompactWorkspaceInitializer, {
      props: { isExpanded: false },
    });

    // First attempt: applyPrefill() arms pendingAutoCreate; the auto-submit
    // $effect fires once the async git check makes the form valid.
    await component.applyPrefill();
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));

    // Retry after failure via the same auto-create path.
    seedAutoCreatePrefill();
    await component.applyPrefill();
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));

    for (const call of mocks.create.mock.calls) {
      const initialAgent = call[0].initialAgent;
      expect(initialAgent).toBeDefined();
      expect(initialAgent.agentId).toBeUndefined();
      expect('agentId' in initialAgent).toBe(false);
    }
  });

  it('does not persist any agent ID in sessionStorage', async () => {
    mocks.create.mockRejectedValue(new Error('daemon rejected create'));

    seedAutoCreatePrefill();
    const { component } = render(CompactWorkspaceInitializer, {
      props: { isExpanded: false },
    });
    await component.applyPrefill();
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));

    expect(sessionStorage.getItem('compact-workspace-initializer-agent-id')).toBeNull();
  });

  it('does not pull a behind source checkout for isolated creation', async () => {
    mocks.create.mockResolvedValue({ ok: false, error: 'stop after payload capture' });
    seedAutoCreatePrefill();
    const { component } = render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
    const picker = await waitFor(
      () =>
        (
          window as unknown as {
            __mockRepoAndBranchPicker?: {
              onBranchStatusChange?: (status: Record<string, unknown>) => void;
            };
          }
        ).__mockRepoAndBranchPicker,
    );
    picker?.onBranchStatusChange?.({
      behind: 2,
      hasUncommittedChanges: true,
      currentBranch: 'main',
      isCurrentBranch: true,
      isLoading: false,
    });

    await component.applyPrefill();
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.pull).not.toHaveBeenCalled();
  });

  it('pulls a behind source checkout before direct creation', async () => {
    mocks.create.mockResolvedValue({ ok: false, error: 'stop after payload capture' });
    seedAutoCreatePrefill();
    const { component } = render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
    const picker = await waitFor(
      () =>
        (
          window as unknown as {
            __mockRepoAndBranchPicker?: {
              onBranchStatusChange?: (status: Record<string, unknown>) => void;
              onSkipIsolationChange?: (value: boolean) => void;
            };
          }
        ).__mockRepoAndBranchPicker,
    );
    picker?.onSkipIsolationChange?.(true);
    picker?.onBranchStatusChange?.({
      behind: 2,
      hasUncommittedChanges: false,
      currentBranch: 'main',
      isCurrentBranch: true,
      isLoading: false,
    });

    await component.applyPrefill();
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.pull).toHaveBeenCalledWith('/tmp/test-repo', 'main');
    expect(mocks.pull.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.create.mock.invocationCallOrder[0],
    );
  });

  it('hydrates the daemon-created agent before opening and navigating to the workspace', async () => {
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

    seedAutoCreatePrefill();
    const { component } = render(CompactWorkspaceInitializer, {
      props: { isExpanded: false },
    });
    await component.applyPrefill();
    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-created'));

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryPath: '/tmp/test-repo',
        baseRef: 'main',
        initialAgent: expect.objectContaining({ prompt: 'Build the thing' }),
      }),
    );

    const dispatched = mocks.dispatch.mock.calls.map(([action]) => action);
    const hydrateIndex = dispatched.findIndex(
      (action) => action.type === 'workspaceNavigation/hydrateWorkspaceNavigation',
    );
    const bootstrapIndex = dispatched.findIndex(
      (action) => action.type === 'panelLayout/bootstrapNewWorkspaceLayout',
    );
    const openIndex = dispatched.findIndex((action) => action.type === 'tabState/openWorkspaceTab');
    expect(dispatched[hydrateIndex]?.payload).toEqual([
      'ws-created',
      expect.objectContaining({
        mainPanel: { type: 'empty' },
        drawer: { open: false, type: null, itemId: null },
      }),
    ]);
    expect(dispatched[bootstrapIndex]?.payload).toEqual(
      expect.objectContaining({
        wsId: 'ws-created',
        initialAgentId: 'agent-created',
        coordinator: true,
      }),
    );
    expect(dispatched[openIndex]?.payload).toEqual(['ws-created']);
    expect(bootstrapIndex).toBeLessThan(hydrateIndex);
    expect(openIndex).toBeGreaterThan(hydrateIndex);
  });

  it('applies a picked reasoning effort to the daemon-created initial agent', async () => {
    mocks.compactFormState$.set({ selectedReasoningEffort: 'high' });
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

    seedAutoCreatePrefill();
    const { component } = render(CompactWorkspaceInitializer, {
      props: { isExpanded: false },
    });
    await component.applyPrefill();

    await waitFor(() =>
      expect(mocks.setReasoningEffort).toHaveBeenCalledWith({
        agentId: 'agent-created',
        workspaceId: 'ws-created',
        reasoningEffort: 'high',
      }),
    );
    expect(mocks.create.mock.calls[0][0].initialAgent).not.toHaveProperty('reasoningEffort');
  });

  it('drops hydrated effort when the saved model belongs to another provider', async () => {
    render(CompactWorkspaceInitializer, { props: { isExpanded: false } });

    mocks.compactFormState$.set({
      selectedModel: 'codex:gpt-5.3-codex',
      modelWasOverridden: true,
      selectedReasoningEffort: 'high',
    });
    mocks.hydrated$.set(true);

    await waitFor(() => {
      const persisted = mocks.dispatch.mock.calls
        .map(([action]) => action)
        .filter((action) => action.type === 'workspaceInitializer/setCompactFormState')
        .at(-1)?.payload[0];
      expect(persisted).toMatchObject({
        selectedModel: undefined,
        selectedReasoningEffort: undefined,
      });
    });
  });

  it('keeps hydrated effort when the saved model matches the active provider', async () => {
    render(CompactWorkspaceInitializer, { props: { isExpanded: false } });

    mocks.compactFormState$.set({
      selectedModel: 'auggie:sonnet-4.6',
      modelWasOverridden: true,
      selectedReasoningEffort: 'high',
    });
    mocks.hydrated$.set(true);

    await waitFor(() => {
      const persisted = mocks.dispatch.mock.calls
        .map(([action]) => action)
        .filter((action) => action.type === 'workspaceInitializer/setCompactFormState')
        .at(-1)?.payload[0];
      expect(persisted).toMatchObject({
        selectedModel: 'auggie:sonnet-4.6',
        selectedReasoningEffort: 'high',
      });
    });
  });
});
