/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
    state: () => ({ workspaceCreateProgress: { byProgressId: {} } }),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-selectors', () => ({
  selectWorkspaceInitializerHydrated: () => mocks.hydrated$,
  selectCompactWorkspaceInitializerFormState: () => mocks.compactFormState$,
  selectWorkspaceInitializerLastSelectedRepo: () => mocks.readable(() => null),
  selectWorkspaceInitializerLastSubmittedAgent: () => mocks.lastSubmittedAgent$,
  selectWorkspaceInitializerRecentRepos: () => mocks.readable(() => []),
  selectWorkspaceInitializerPendingGitHubPrefill: () => mocks.readable(() => null),
  selectWorkspaceInitializerBranchByRepo: () => mocks.readable(() => ({})),
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
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
  preloadIssues: vi.fn(),
}));

vi.mock('$lib/components/workspace/initializer/RepoSelector.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockRepoSelector.svelte')).default,
}));

vi.mock('$lib/components/chat/AttachmentPreview.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

import CompactWorkspaceInitializer from '../CompactWorkspaceInitializer.svelte';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { registerMockIpcHandler, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { m } from '$shared/paraglide/messages.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('existing repository creation boundary (#5771)', () => {
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollIntoView',
  );
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });
  afterAll(() => {
    if (originalScrollIntoView)
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  });
  let root: string;
  let repo: string;
  let nonGit: string;
  let directoryProbe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    resetMockIpcRouter();
    root = mkdtempSync(join(tmpdir(), 'workspace-existing-repo-'));
    repo = join(root, 'repo');
    nonGit = join(root, 'old-ledger');
    mkdirSync(repo);
    mkdirSync(nonGit);
    const gitEnv = {
      PATH: process.env.PATH,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
    };
    execFileSync('git', ['init', '--quiet', repo], { timeout: 5000, env: gitEnv });
    directoryProbe = vi.fn(async ({ path }: { path: string }) => {
      const isDirectory = statSync(path).isDirectory();
      let isGitRepo = false;
      try {
        isGitRepo =
          execFileSync('git', ['-C', path, 'rev-parse', '--is-inside-work-tree'], {
            encoding: 'utf8',
            timeout: 5000,
            env: gitEnv,
            stdio: ['ignore', 'pipe', 'pipe'],
          }).trim() === 'true';
      } catch {
        /* A real non-Git folder is the negative control. */
      }
      return {
        success: true,
        data: {
          path,
          exists: true,
          isDirectory,
          isEmpty: readdirSync(path).length === 0,
          isGitRepo,
          isSubdirectoryOfGitRepo: false,
        },
      };
    });
    registerMockIpcHandler('file:getDirectoryStatus', directoryProbe);
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

  async function mountSelection(path: string, isNewRepo = false) {
    mocks.compactFormState$.set({
      repoPath: path,
      repoType: 'local',
      isValidPath: true,
      isNewRepo,
      branch: '',
    });
    sessionStorage.setItem('workspace-prefill', JSON.stringify({ prompt: 'Build the project' }));
    return render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
  }

  async function submit() {
    const create = document.querySelector<HTMLButtonElement>('[data-dialog-primary-action]');
    expect(create).toBeTruthy();
    await waitFor(() => expect(create!.disabled).toBe(false));
    await fireEvent.click(create!);
  }

  it('keeps the explicitly selected repository through deferred branch failure and manual entry', async () => {
    const branches = deferred<null>();
    mocks.getBranches.mockReturnValue(branches.promise);
    mocks.hydrated$.set(false);
    const { component } = await mountSelection(nonGit);
    await waitFor(() => expect(mocks.getBranches).toHaveBeenCalledWith(nonGit, true));
    // Exercise the public prefill route while an old branch request is pending.
    sessionStorage.setItem('workspace-prefill', JSON.stringify({ repoPath: repo }));
    await component.applyPrefill();
    await waitFor(() => expect(mocks.getBranches).toHaveBeenCalledWith(repo, true));
    // Late daemon settings must not restore the previous folder over the explicit selection.
    mocks.compactFormState$.set({
      repoPath: nonGit,
      repoType: 'local',
      isValidPath: true,
      isNewRepo: false,
      branch: 'old-branch',
    });
    mocks.hydrated$.set(true);
    branches.reject(new Error('branch fetch unavailable'));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    await fireEvent.click(
      screen.getByRole('button', { name: `${m.workspace_branchSelector_selectBranch_label()}:` }),
    );
    await fireEvent.input(screen.getByPlaceholderText('Search or enter branch name...'), {
      target: { value: 'manual-recovery' },
    });
    await fireEvent.pointerUp(
      await screen.findByRole('option', {
        name: m.ui_combobox_useCustom_label({ value: 'manual-recovery' }),
      }),
      { pointerType: 'mouse', button: 0 },
    );
    await submit();
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(directoryProbe).toHaveBeenCalledExactlyOnceWith({ path: repo });
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      repositoryPath: repo,
      baseRef: 'manual-recovery',
      isNewRepo: false,
    });
  });

  it.each([false, true])(
    'does not send workspace.create for a real non-Git folder (nonempty=%s)',
    async (nonempty) => {
      if (nonempty) writeFileSync(join(nonGit, 'ledger.txt'), 'existing local notes');
      await mountSelection(nonGit);
      await submit();
      await waitFor(() =>
        expect(screen.getByText(m.workspace_repoSelector_notGitRepository_label())).toBeTruthy(),
      );
      expect(directoryProbe).toHaveBeenCalledExactlyOnceWith({ path: nonGit });
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );

  it('keeps deliberate creation of a repository in a real non-Git folder', async () => {
    await mountSelection(nonGit, true);
    await submit();
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      repositoryPath: nonGit,
      baseRef: 'main',
      isNewRepo: true,
    });
  });

  it('does not send workspace.create when an existing repository cannot be verified', async () => {
    directoryProbe.mockRejectedValue(new Error('daemon disconnected'));
    await mountSelection(repo);
    await submit();
    await waitFor(() =>
      expect(screen.getByText(m.workspace_compactInitializer_gitCheckUnknown_label())).toBeTruthy(),
    );
    expect(directoryProbe).toHaveBeenCalledExactlyOnceWith({ path: repo });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
