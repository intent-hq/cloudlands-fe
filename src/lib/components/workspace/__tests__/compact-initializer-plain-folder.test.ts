import { withLegacyPrincipal } from '../../../../test/fixtures/principal-state';
/** @vitest-environment jsdom */
/**
 * Plain-folder workspaces (Labs) in the New Workspace dialog: the
 * "Initialize as git repository" toggle, hidden git-only controls, the
 * in-place/no-undo warning (cancel creates nothing) and the plain-folder
 * `workspace.create` request. With the Labs flag off the dialog renders and
 * creates exactly as today.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceInitializationOutcome } from '$store/renderer/slices/workspace-initializer/workspace-initializer-types';
import { createWorkspaceInitializationDispatchAdapter } from './workspace-initialization-dispatch.test-helper';

const admittedFixture = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
const plainFolder = vi.hoisted(() => {
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
    available$: writable(false),
    defaultState$: writable<'on' | 'off' | 'pending'>('pending'),
    gitAvailable$: writable<boolean | null | 'unknown'>(true),
    confirm: vi.fn(async (_folder: string, _workspaces: unknown[]) => true),
  };
});
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
    getBranches: vi.fn(),
    toastError: vi.fn(),
    pull: vi.fn(async () => ({ success: true })),
    setReasoningEffort: vi.fn(),
    initializationOutcome$: writable<Partial<WorkspaceInitializationOutcome> | undefined>(
      undefined,
    ),
    hydrated$: writable(false),
    compactFormState$: writable<{
      selectedSpecialist?: string | null;
      selectedModel?: string;
      modelWasOverridden?: boolean;
      selectedReasoningEffort?: string;
      isTeamMode?: boolean;
      skipIsolation?: boolean;
      repoPath?: string;
      repoType?: string;
      isValidPath?: boolean;
      isNewRepo?: boolean;
      branch?: string;
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
  selectWorkspaceInitializerGitAvailability: () => plainFolder.gitAvailable$,
  selectWorkspaceInitializerHydrated: () => mocks.hydrated$,
  selectCompactWorkspaceInitializerFormState: () => mocks.compactFormState$,
  selectWorkspaceInitializerLastSelectedRepo: () => mocks.readable(() => null),
  selectWorkspaceInitializerLastSubmittedAgent: () => mocks.lastSubmittedAgent$,
  selectWorkspaceInitializerRecentRepos: () => mocks.readable(() => []),
  selectWorkspaceInitializerPendingGitHubPrefill: () => mocks.readable(() => null),
  selectWorkspaceInitializerBranchByRepo: () => mocks.readable(() => ({})),
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

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceItems: () => mocks.readable(() => []),
}));

vi.mock('$lib/components/ui/toast', () => ({
  toast: { error: mocks.toastError, success: vi.fn(), warning: vi.fn(), message: vi.fn() },
}));

vi.mock('$lib/config/debug', () => ({
  debugConfig: { get: vi.fn(() => false) },
}));

vi.mock('$lib/client', () => ({
  appClient: {
    agents: { setReasoningEffort: mocks.setReasoningEffort },
    git: {
      pull: mocks.pull,
      getBranches: mocks.getBranches,
      branchStatus: vi.fn(async () => null),
    },
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
  default: (await import('./mocks/MockIssueSuggestions.svelte')).default,
  preloadIssues: vi.fn(),
}));

vi.mock('$lib/components/workspace/initializer/RepoAndBranchPicker.svelte', async () => ({
  default: (await import('./mocks/MockRepoAndBranchPicker.svelte')).default,
}));

vi.mock('$store/renderer/slices/workspace-initializer/plain-folder-selectors', () => ({
  selectPlainFolderCreationAvailable: () => plainFolder.available$,
  selectInitializeGitDefaultState: () => plainFolder.defaultState$,
}));

vi.mock('$lib/components/workspace/initializer/plain-folder-confirm', () => ({
  confirmPlainFolderInPlace: plainFolder.confirm,
}));

vi.mock('$lib/components/chat/AttachmentPreview.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

import CompactWorkspaceInitializer from '../CompactWorkspaceInitializer.svelte';
import { mkdtempSync, mkdirSync, rmSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerMockIpcHandler, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { m } from '$shared/paraglide/messages.js';
import { INITIALIZE_GIT_CHOICE_STORAGE_KEY } from '../initializer/plain-folder-create';

type PickerCallbacks = {
  onRepoChange: (event: { detail: Record<string, unknown> }) => void;
};
const picker = () =>
  (window as unknown as { __mockRepoAndBranchPicker: PickerCallbacks }).__mockRepoAndBranchPicker;
const toggle = () =>
  screen.queryByRole('switch', { name: m.workspace_plainFolder_initializeGit_label() });
const gitOnlyKeys = [
  'githubUrl',
  'branch',
  'baseRef',
  'isNewRepo',
  'skipIsolation',
  'setupScript',
  'scope',
];

describe('New Workspace — plain-folder toggle (Labs)', () => {
  let root: string;
  let folder: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(localStorage.getItem).mockImplementation(() => null);
    plainFolder.available$.set(false);
    plainFolder.defaultState$.set('pending');
    plainFolder.gitAvailable$.set(true);
    plainFolder.confirm.mockResolvedValue(true);
    mocks.initializationOutcome$.set(undefined);
    mocks.dispatch.mockImplementation(
      createWorkspaceInitializationDispatchAdapter({
        create: mocks.create,
        pull: mocks.pull,
        setOutcome: (outcome) => mocks.initializationOutcome$.set(outcome),
      }),
    );
    sessionStorage.clear();
    resetMockIpcRouter();
    root = mkdtempSync(join(tmpdir(), 'workspace-plain-folder-'));
    folder = join(root, 'notes');
    mkdirSync(folder);
    registerMockIpcHandler('file:getDirectoryStatus', async ({ path }: { path: string }) => {
      let exists = true;
      let isDirectory = false;
      try {
        isDirectory = statSync(path).isDirectory();
      } catch {
        exists = false;
      }
      return {
        success: true,
        data: {
          path,
          exists,
          isDirectory,
          isEmpty: exists && isDirectory ? readdirSync(path).length === 0 : true,
          isGitRepo: false,
          isSubdirectoryOfGitRepo: false,
        },
      };
    });
    mocks.hydrated$.set(true);
    mocks.compactFormState$.set(null);
    mocks.lastSubmittedAgent$.set(null);
    mocks.specialists$.set([mocks.coordinator, mocks.developer]);
    mocks.customSpecialistsLoaded$.set(true);
    mocks.fileSpecialistsLoaded$.set(true);
    mocks.create.mockResolvedValue({ ok: false, error: 'stop after payload capture' });
    mocks.getBranches.mockResolvedValue({
      branches: ['main'],
      remoteBranches: [],
      defaultBranch: 'main',
      currentBranch: 'main',
    });
  });

  afterEach(() => {
    cleanup();
    resetMockIpcRouter();
    sessionStorage.clear();
    rmSync(root, { recursive: true, force: true });
  });

  function mountDialog() {
    sessionStorage.setItem('workspace-prefill', JSON.stringify({ prompt: 'Organize my notes' }));
    return render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
  }

  async function pick(detail: Record<string, unknown>) {
    await waitFor(() => expect(picker()).toBeTruthy());
    picker().onRepoChange({
      detail: { type: 'local', isNewRepo: false, isValidPath: true, ...detail },
    });
  }

  async function submit() {
    const create = document.querySelector<HTMLButtonElement>('[data-dialog-primary-action]');
    expect(create).toBeTruthy();
    await waitFor(() => expect(create!.disabled).toBe(false));
    await fireEvent.click(create!);
  }

  const setupScriptHidden = () =>
    screen.getByTestId('initializer-setup-script').classList.contains('hidden');

  it('with Labs off renders no toggle and keeps every git control', async () => {
    plainFolder.defaultState$.set('off');
    mountDialog();
    await waitFor(() => expect(picker()).toBeTruthy());
    expect(toggle()).toBeNull();
    expect(screen.getByTestId('issue-suggestions')).toBeTruthy();
    expect(setupScriptHidden()).toBe(false);
    expect(screen.getByTestId('picker-plain-folder-mode').textContent).toBe('false');
  });

  it('stays hidden while the default is undecided', async () => {
    plainFolder.available$.set(true);
    mountDialog();
    await waitFor(() => expect(picker()).toBeTruthy());
    expect(toggle()).toBeNull();
    expect(screen.getByTestId('picker-plain-folder-mode').textContent).toBe('false');
  });

  it('defaults on with a forge or git workspace and keeps git behavior', async () => {
    plainFolder.available$.set(true);
    plainFolder.defaultState$.set('on');
    mountDialog();
    const sw = await waitFor(() => toggle()!);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('issue-suggestions')).toBeTruthy();
    expect(setupScriptHidden()).toBe(false);
  });

  it('defaults off: hides branch, setup script and issue/PR suggestions', async () => {
    plainFolder.available$.set(true);
    plainFolder.defaultState$.set('off');
    mountDialog();
    const sw = await waitFor(() => toggle()!);
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('picker-plain-folder-mode').textContent).toBe('true');
    expect(screen.queryByTestId('issue-suggestions')).toBeNull();
    expect(setupScriptHidden()).toBe(true);
  });

  it('does not change a remembered choice when the default would differ', async () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) =>
      key === INITIALIZE_GIT_CHOICE_STORAGE_KEY ? 'false' : null,
    );
    plainFolder.available$.set(true);
    plainFolder.defaultState$.set('on');
    mountDialog();
    const sw = await waitFor(() => toggle()!);
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await fireEvent.click(sw);
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'));
    expect(localStorage.setItem).toHaveBeenCalledWith(INITIALIZE_GIT_CHOICE_STORAGE_KEY, 'true');
  });

  it('warns before using an existing folder in place; cancel creates nothing', async () => {
    plainFolder.available$.set(true);
    plainFolder.defaultState$.set('off');
    plainFolder.confirm.mockResolvedValue(false);
    mountDialog();
    await waitFor(() => expect(toggle()).toBeTruthy());
    await pick({ path: folder, plainFolder: 'existing' });
    await waitFor(() =>
      expect(screen.getByTestId('picker-plain-folder').textContent).toBe('existing'),
    );

    await submit();
    await waitFor(() => expect(plainFolder.confirm).toHaveBeenCalledTimes(1));
    expect(plainFolder.confirm.mock.calls[0][0]).toBe(folder);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('creates a plain-folder workspace in an existing folder after the warning', async () => {
    plainFolder.available$.set(true);
    plainFolder.defaultState$.set('off');
    mountDialog();
    await waitFor(() => expect(toggle()).toBeTruthy());
    await pick({ path: folder, plainFolder: 'existing' });

    await submit();
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(plainFolder.confirm).toHaveBeenCalledTimes(1);
    const params = mocks.create.mock.calls[0][0] as Record<string, unknown>;
    expect(params).toMatchObject({ repositoryPath: folder, plainFolder: true });
    for (const key of gitOnlyKeys) expect(params).not.toHaveProperty(key);
  });

  it('creates a new plain folder without the in-place warning', async () => {
    plainFolder.available$.set(true);
    plainFolder.defaultState$.set('off');
    mountDialog();
    await waitFor(() => expect(toggle()).toBeTruthy());
    const target = join(root, 'new-project');
    await pick({ path: target, plainFolder: 'new' });

    await submit();
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(plainFolder.confirm).not.toHaveBeenCalled();
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      repositoryPath: target,
      plainFolder: true,
    });
  });

  it('shows which repository a git pick belongs to and keeps it a git workspace', async () => {
    plainFolder.available$.set(true);
    plainFolder.defaultState$.set('off');
    mountDialog();
    await waitFor(() => expect(toggle()).toBeTruthy());
    await pick({ path: join(root, 'repo', 'docs'), scope: 'docs' });

    const notice = await screen.findByTestId('plain-folder-git-notice');
    expect(notice.textContent).toContain(join(root, 'repo'));
    expect(screen.getByTestId('picker-plain-folder').textContent).toBe('');
    expect(screen.getByTestId('issue-suggestions')).toBeTruthy();
    expect(setupScriptHidden()).toBe(false);
  });

  it('drops a plain-folder pick when the toggle is turned on', async () => {
    plainFolder.available$.set(true);
    plainFolder.defaultState$.set('off');
    mountDialog();
    const sw = await waitFor(() => toggle()!);
    await pick({ path: folder, plainFolder: 'existing' });
    await waitFor(() => expect(screen.getByTestId('picker-repo-path').textContent).toBe(folder));

    await fireEvent.click(sw);
    await waitFor(() => expect(screen.getByTestId('picker-repo-path').textContent).toBe(''));
    expect(screen.getByTestId('picker-plain-folder').textContent).toBe('');
  });

  it('hides the toggle for a forge clone pick', async () => {
    plainFolder.available$.set(true);
    plainFolder.defaultState$.set('off');
    mountDialog();
    await waitFor(() => expect(toggle()).toBeTruthy());
    await pick({
      path: 'acme/app',
      type: 'github',
      githubUrl: 'https://github.com/acme/app',
    });
    await waitFor(() => expect(toggle()).toBeNull());
  });

  describe('Git not installed (Git not required without a forge)', () => {
    const gitBanner = () => screen.queryByText('Git is not installed');

    it('hides the banner and allows a plain-folder create with the toggle off', async () => {
      plainFolder.gitAvailable$.set(false);
      plainFolder.available$.set(true);
      plainFolder.defaultState$.set('off');
      mountDialog();
      await waitFor(() => expect(toggle()).toBeTruthy());
      await waitFor(() => expect(gitBanner()).toBeNull());
      await pick({ path: folder, plainFolder: 'existing' });
      expect(gitBanner()).toBeNull();
      await submit();
      await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    });

    it('prompts to install Git for a git workspace (toggle on)', async () => {
      plainFolder.gitAvailable$.set(false);
      plainFolder.available$.set(true);
      plainFolder.defaultState$.set('on');
      mountDialog();
      await waitFor(() => expect(toggle()).toBeTruthy());
      expect(gitBanner()).toBeTruthy();
      expect(screen.getByText('Download Git →')).toBeTruthy();
      const create = document.querySelector<HTMLButtonElement>('[data-dialog-primary-action]');
      expect(create?.disabled).toBe(true);
    });

    it('keeps the banner with Labs off', async () => {
      plainFolder.gitAvailable$.set(false);
      mountDialog();
      await waitFor(() => expect(picker()).toBeTruthy());
      expect(gitBanner()).toBeTruthy();
    });
  });
});
