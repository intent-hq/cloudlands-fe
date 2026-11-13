import { withLegacyPrincipal } from '../../../../test/fixtures/principal-state';
/**
 * @vitest-environment jsdom
 *
 * New Workspace → codebase picker → Sessions: picking a session selects its
 * codebase (the daemon's `repoRoot`, else a folder match for older daemons) and
 * its last branch asynchronously. Create waits for that match, a late match
 * never overrides a repository the user picked meanwhile (cloudlands-fe#4465
 * review), and picking another codebase drops the import.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const admittedFixture = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
beforeEach(() => {
  admittedFixture.state = withLegacyPrincipal({});
});

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
      get() {
        return value;
      },
    };
  }
  const coordinator = {
    id: 'spec-writer',
    name: 'Coordinator',
    description: '',
    role: 'orchestrator',
  };
  const developer = { id: 'developer', name: 'Developer', description: '' };
  return {
    readable,
    dispatch: vi.fn(),
    goto: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    pull: vi.fn(async () => ({ success: true })),
    getBranches: vi.fn(),
    directoryStatus: vi.fn(),
    setReasoningEffort: vi.fn(),
    initializationOutcome$: writable<
      | Partial<
          import('$store/renderer/slices/workspace-initializer/workspace-initializer-types').WorkspaceInitializationOutcome
        >
      | undefined
    >(undefined),
    hydrated$: writable(false),
    compactFormState$: writable<{
      selectedSpecialist?: string | null;
      selectedModel?: string;
      modelWasOverridden?: boolean;
      selectedReasoningEffort?: string;
      isTeamMode?: boolean;
      skipIsolation?: boolean;
    } | null>(null),
    lastSubmittedAgent$: writable<{
      selectedSpecialist: string | null;
      selectedModel?: string;
      modelWasOverridden?: boolean;
      selectedReasoningEffort?: string;
      isTeamMode: boolean;
      selectedProvider?: string;
    } | null>(null),
    specialists$: writable([coordinator, developer]),
    customSpecialistsLoaded$: writable(true),
    fileSpecialistsLoaded$: writable(true),
    coordinator,
    developer,
  };
});

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ ...admittedFixture.state, workspaceCreateProgress: { byProgressId: {} } }),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-selectors', () => ({
  selectWorkspaceInitializerAgentForRepo: { select: () => null },
  selectWorkspaceInitializerGitAvailability: () => ({
    subscribe(run: (value: boolean) => void) {
      run(true);
      return () => {};
    },
  }),
  selectWorkspaceInitializerHydrated: () => mocks.hydrated$,
  selectCompactWorkspaceInitializerFormState: () => mocks.compactFormState$,
  selectWorkspaceInitializerLastSelectedRepo: () => mocks.readable(() => null),
  selectWorkspaceInitializerLastSubmittedAgent: () => mocks.lastSubmittedAgent$,
  selectWorkspaceInitializerRecentRepos: () => mocks.readable(() => []),
  selectWorkspaceInitializerPendingGitHubPrefill: () => mocks.readable(() => null),
  selectWorkspaceInitializerDefaultParentPath: () => mocks.readable(() => ''),
  selectWorkspaceInitializerDraftAuthority: () =>
    mocks.readable(() => ({ restore: undefined, clear: undefined })),
  selectWorkspaceInitializationOutcomeForConsumer: () => mocks.initializationOutcome$,
  selectWorkspaceInitializationResume: { select: () => undefined },
}));

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectAvailableModels: () => mocks.readable(() => []),
  selectSelectedModel: () => mocks.readable(() => undefined),
}));

vi.mock('$store/renderer/slices/provider-settings/provider-settings-selectors', () => ({
  selectActiveProviderId: () => mocks.readable(() => 'auggie'),
  selectEnabledProviders: () => mocks.readable(() => ({})),
}));

vi.mock('$store/renderer/slices/hardware-console/hardware-console-selectors', () => ({
  selectPttRecording: () => mocks.readable(() => false),
  selectVoiceTranscribing: () => mocks.readable(() => false),
}));

vi.mock('$store/renderer/slices/voice-settings/voice-settings-selectors', () => ({
  selectEffectiveVoiceEngine: () => mocks.readable(() => 'os'),
}));

vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: Object.assign(() => mocks.specialists$, {
    select: vi.fn(() => mocks.specialists$.get()),
  }),
  selectCustomSpecialistsLoaded: () => mocks.customSpecialistsLoaded$,
  selectFileSpecialistsLoaded: () => mocks.fileSpecialistsLoaded$,
  selectEffectiveBehaviorPrompt: { select: vi.fn(() => undefined) },
  selectEffectiveModel: { select: vi.fn(() => undefined) },
  selectEffectiveCodingAgent: { select: vi.fn(() => undefined) },
  selectUserOverrides: { select: vi.fn(() => ({ modelOverrides: {} })) },
  selectOrchestratorSpecialist: Object.assign(() => mocks.readable(() => mocks.coordinator), {
    select: vi.fn(() => mocks.coordinator),
  }),
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
    git: { pull: mocks.pull, getBranches: mocks.getBranches },
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

vi.mock('$lib/utils/workspace-validation', async (importOriginal) => ({
  getGitErrorMessage: (await importOriginal<typeof import('$lib/utils/workspace-validation')>())
    .getGitErrorMessage,
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
    if (channel === 'file:getDirectoryStatus') return mocks.directoryStatus();
    return { success: true, data: null };
  }),
  listen: vi.fn(async () => () => {}),
  listenSync: vi.fn(() => () => {}),
  emit: vi.fn(async () => {}),
  shell: { open: vi.fn(async () => {}) },
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
import { createWorkspaceInitializationDispatchAdapter } from './workspace-initialization-dispatch.test-helper';

const PREFILL_KEY = 'workspace-prefill';

function seedRepositoryPrefill() {
  sessionStorage.setItem(
    PREFILL_KEY,
    JSON.stringify({
      repoPath: '/tmp/test-repo',
      branch: 'main',
      prompt: 'Continue the work',
    }),
  );
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('./mocks/MockRichTextarea.svelte'));
warmImport(() => import('../initializer/__tests__/mocks/MockComponent.svelte'));

const created = {
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
  },
};

type Picker = {
  onRepoChange?: (event: { detail: Record<string, unknown> }) => void;
  onBranchChange?: (event: { detail: { branch: string } }) => void;
  onSessionSelect?: (session: Record<string, unknown>) => void;
};

const session = {
  provider: 'claude-code',
  sessionId: '6eca79e3-7963-44ad-b89e-e781d28df2b9',
  title: 'Cloudflare account installation',
  cwd: '/work/ember/apps/web',
  gitBranch: 'openid-sign-in',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const repoPicker = () =>
  (window as unknown as { __mockRepoAndBranchPicker: Picker }).__mockRepoAndBranchPicker;
const pickSession = (pick: Record<string, unknown> = session) =>
  repoPicker().onSessionSelect?.(pick);
const createButton = () =>
  screen.getByRole('button', { name: /create workspace/i }) as HTMLButtonElement;
const sessionFolderIsInsideEmber = {
  success: true,
  data: {
    exists: true,
    isGitRepo: false,
    isSubdirectoryOfGitRepo: true,
    relativePathFromGitRoot: 'apps/web',
  },
};

describe('CompactWorkspaceInitializer import-session repository match', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dispatch.mockImplementation(
      createWorkspaceInitializationDispatchAdapter({
        create: mocks.create,
        pull: mocks.pull,
        setOutcome: (outcome) => mocks.initializationOutcome$.set(outcome),
      }),
    );
    mocks.create.mockResolvedValue(created);
    mocks.getBranches.mockResolvedValue({
      branches: ['main', 'openid-sign-in'],
      remoteBranches: [],
      currentBranch: 'main',
      defaultBranch: 'main',
    });
    mocks.initializationOutcome$.set(undefined);
    sessionStorage.clear();
    mocks.hydrated$.set(false);
    mocks.compactFormState$.set(null);
    mocks.lastSubmittedAgent$.set(null);
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  async function renderWithRepository() {
    seedRepositoryPrefill();
    const { component } = render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
    await component.applyPrefill();
    await waitFor(() => expect(createButton().disabled).toBe(false));
  }

  it('keeps Create disabled until the session repository match settles, then creates there', async () => {
    const lookup = deferred<typeof sessionFolderIsInsideEmber>();
    mocks.directoryStatus.mockReturnValueOnce(lookup.promise);
    await renderWithRepository();

    pickSession();
    await waitFor(() => expect(createButton().disabled).toBe(true));
    await fireEvent.click(createButton());
    expect(mocks.create).not.toHaveBeenCalled();

    lookup.resolve(sessionFolderIsInsideEmber);
    await waitFor(() =>
      expect(screen.getByTestId('picker-repo-path').textContent).toBe('/work/ember'),
    );
    await waitFor(() =>
      expect(screen.getByTestId('picker-branch').textContent).toBe('openid-sign-in'),
    );
    await waitFor(() => expect(createButton().disabled).toBe(false));

    await fireEvent.click(createButton());
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    const request = mocks.create.mock.calls[0][0] as Record<string, unknown>;
    expect(request.repositoryPath).toBe('/work/ember');
    expect(request.baseRef).toBe('openid-sign-in');
    expect(request).not.toHaveProperty('initialAgent');
  });

  it('ignores a late session match after the user picks another repository', async () => {
    const lookup = deferred<typeof sessionFolderIsInsideEmber>();
    mocks.directoryStatus.mockReturnValueOnce(lookup.promise);
    await renderWithRepository();

    pickSession();
    await waitFor(() => expect(createButton().disabled).toBe(true));
    repoPicker().onRepoChange?.({
      detail: { path: '/tmp/manual-repo', type: 'local', isValidPath: true },
    });
    repoPicker().onBranchChange?.({ detail: { branch: 'main' } });
    await waitFor(() => expect(createButton().disabled).toBe(false));

    lookup.resolve(sessionFolderIsInsideEmber);
    await lookup.promise;
    await new Promise((done) => setTimeout(done, 0));
    expect(screen.getByTestId('picker-repo-path').textContent).toBe('/tmp/manual-repo');
    expect(screen.getByTestId('picker-branch').textContent).toBe('main');
    expect(mocks.getBranches).not.toHaveBeenCalled();

    await fireEvent.click(createButton());
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect((mocks.create.mock.calls[0][0] as Record<string, unknown>).repositoryPath).toBe(
      '/tmp/manual-repo',
    );
  });

  it('uses the session repoRoot directly, without a folder lookup', async () => {
    await renderWithRepository();

    pickSession({ ...session, repoRoot: '/work/ember' });
    await waitFor(() =>
      expect(screen.getByTestId('picker-repo-path').textContent).toBe('/work/ember'),
    );
    await waitFor(() =>
      expect(screen.getByTestId('picker-branch').textContent).toBe('openid-sign-in'),
    );
    expect(mocks.directoryStatus).not.toHaveBeenCalled();
    expect(screen.getByTestId('picker-session').textContent).toBe(session.sessionId);
    expect(screen.getByTestId('import-session-note')).toBeTruthy();
  });

  it('drops the import when the user picks another codebase', async () => {
    await renderWithRepository();

    pickSession({ ...session, repoRoot: '/work/ember' });
    await waitFor(() =>
      expect(screen.getByTestId('picker-session').textContent).toBe(session.sessionId),
    );
    await waitFor(() => expect(createButton().disabled).toBe(false));
    repoPicker().onRepoChange?.({
      detail: { path: '/tmp/manual-repo', type: 'local', isValidPath: true },
    });
    await waitFor(() => expect(screen.getByTestId('picker-session').textContent).toBe(''));
    expect(screen.queryByTestId('import-session-note')).toBeNull();
  });
});
