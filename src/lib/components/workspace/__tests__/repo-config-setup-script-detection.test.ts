/**
 * @vitest-environment jsdom
 *
 * The New Workspace modal (CompactWorkspaceInitializer) must detect the
 * repo-committed `.intent/config.json` setup script through the shared probe
 * helper (monorepo#833): spinner on the setup-script control while the probe
 * is in flight, "From repo config" once it resolves, and restored form state
 * never clobbered. GitHub selections also re-probe (debounced) when the
 * branch changes (monorepo#835). This is the modal-side counterpart of the
 * onboarding suite, so a modal-only edit can no longer go untested.
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
  return {
    readable,
    dispatch: vi.fn(),
    goto: vi.fn(),
    savedFormState: null as Record<string, unknown> | null,
    fetchRepoConfig: vi.fn<(repoPath: string) => Promise<string | null>>(),
    fetchGitHubRepoConfig:
      vi.fn<(owner: string, repo: string, ref?: string) => Promise<string | null>>(),
    lastUsedSelect: vi.fn(),
  };
});

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({
    state: () => ({ hardwareConsole: { pttRecording: false, voiceTranscribing: false } }),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-selectors', () => ({
  selectWorkspaceInitializerHydrated: () => mocks.readable(() => false),
  selectCompactWorkspaceInitializerFormState: () => mocks.readable(() => mocks.savedFormState),
  selectWorkspaceInitializerLastSelectedRepo: () => mocks.readable(() => null),
  selectWorkspaceInitializerLastSubmittedAgent: () => mocks.readable(() => null),
  selectWorkspaceInitializerRecentRepos: () => mocks.readable(() => []),
}));

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectAvailableModels: () => mocks.readable(() => []),
  selectSelectedModel: () => mocks.readable(() => undefined),
}));

vi.mock('$store/renderer/slices/provider-settings/provider-settings-selectors', () => ({
  selectActiveProviderId: () => mocks.readable(() => 'auggie'),
}));

vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: Object.assign(() => mocks.readable(() => []), {
    select: vi.fn(() => []),
  }),
  selectEffectiveBehaviorPrompt: { select: vi.fn(() => undefined) },
  selectEffectiveModel: { select: vi.fn(() => undefined) },
  selectEffectiveCodingAgent: { select: vi.fn(() => undefined) },
  selectUserOverrides: { select: vi.fn(() => ({ modelOverrides: {} })) },
}));

vi.mock('$store/renderer/slices/setup-scripts/setup-scripts-selectors', () => ({
  selectLastUsedScriptForRepo: { select: mocks.lastUsedSelect },
}));

// Keep the real priority logic and the shared probe helper; only the
// IPC/daemon-backed probes are stubbed. Mock the deep module (not the
// barrel) so the helper's relative import of './repo-config' resolves to
// the same stubs.
vi.mock('$features/setup-scripts/repo-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$features/setup-scripts/repo-config')>()),
  fetchRepoConfigSetupScript: mocks.fetchRepoConfig,
  fetchGitHubRepoConfigSetupScript: mocks.fetchGitHubRepoConfig,
}));

vi.mock('$lib/config/debug', () => ({
  debugConfig: { get: vi.fn(() => false) },
}));

vi.mock('$lib/client', () => ({
  appClient: { git: { pull: vi.fn(async () => ({ success: true })) }, drafts: {} },
}));

vi.mock('$lib/client/live/live-prompt-enhancement', () => ({
  enhancePrompt: vi.fn(async (p: string) => ({ enhanced: p })),
  isEnhancePromptAvailable: vi.fn(() => true),
}));

// Keep the real parseGitHubUrl (the shared probe helper depends on it);
// stub only the git/path validation the component calls on mount.
vi.mock('$lib/utils/workspace-validation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/utils/workspace-validation')>()),
  validateRepoPath: vi.fn(async () => ({ valid: true })),
}));

vi.mock('$shared/generated/ipc-client', () => ({
  invoke: vi.fn(async () => ({ success: false })),
}));

vi.mock('$store/renderer/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { create: vi.fn(), update: vi.fn() },
}));

vi.mock('$lib/components/workspace/initializer/new-workspace-draft', () => ({
  restoreNewWorkspaceDraft: vi.fn(async () => ({ status: 'none' })),
  createNewWorkspaceDraftSaver: vi.fn(() => ({ schedule: vi.fn(), flush: vi.fn() })),
  clearNewWorkspaceDraft: vi.fn(),
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

vi.mock('$lib/components/ui/tooltip/Tooltip.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
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
import { REPO_CONFIG_SCRIPT_NAME } from '$features/setup-scripts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function renderInitializer() {
  return render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
}

const SPINNER_LABEL = 'Detecting setup script…';

/** Callbacks the initializer passed to the (mocked) RepoAndBranchPicker. */
function pickerCallbacks() {
  return (
    window as unknown as {
      __mockRepoAndBranchPicker: {
        onRepoChange: (event: { detail: Record<string, unknown> }) => void;
        onBranchChange: (event: { detail: { branch: string } }) => void;
      };
    }
  ).__mockRepoAndBranchPicker;
}

/** Drive a GitHub repo selection through the picker's onRepoChange. */
function selectGitHubRepo(overrides: Record<string, unknown> = {}) {
  pickerCallbacks().onRepoChange({
    detail: {
      path: '/clones/repo',
      type: 'github',
      githubUrl: 'https://github.com/owner/repo',
      isValidPath: true,
      ...overrides,
    },
  });
}

describe('CompactWorkspaceInitializer repo-config setup script detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.savedFormState = null;
    mocks.lastUsedSelect.mockReturnValue(undefined);
    mocks.fetchRepoConfig.mockResolvedValue(null);
    mocks.fetchGitHubRepoConfig.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it('shows the spinner while the GitHub probe is in flight, then applies the repo-config script', async () => {
    const probe = deferred<string | null>();
    mocks.fetchGitHubRepoConfig.mockReturnValue(probe.promise);
    mocks.savedFormState = {
      repoPath: '/clones/repo',
      repoType: 'github',
      githubUrl: 'https://github.com/owner/repo',
      branch: 'release-1.x',
      isValidPath: true,
    };

    const result = renderInitializer();
    await waitFor(() => {
      expect(result.getByText(SPINNER_LABEL)).toBeTruthy();
    });
    expect(mocks.fetchGitHubRepoConfig).toHaveBeenCalledWith('owner', 'repo', 'release-1.x');
    expect(mocks.fetchRepoConfig).not.toHaveBeenCalled();

    probe.resolve('echo gh-config');
    await waitFor(() => {
      expect(result.getByText(REPO_CONFIG_SCRIPT_NAME)).toBeTruthy();
    });
    expect(result.queryByText(SPINNER_LABEL)).toBeNull();
  });

  it('probes a local saved repo path and defaults to "From repo config"', async () => {
    // A last-used script exists too — repo config must win the priority.
    mocks.lastUsedSelect.mockReturnValue({ name: 'My saved script', content: 'echo saved' });
    mocks.fetchRepoConfig.mockResolvedValue('echo repo-config');
    mocks.savedFormState = { repoPath: '/repo/a', repoType: 'local', isValidPath: true };

    const result = renderInitializer();
    await waitFor(() => {
      expect(result.getByText(REPO_CONFIG_SCRIPT_NAME)).toBeTruthy();
    });
    expect(mocks.fetchRepoConfig).toHaveBeenCalledWith('/repo/a');
  });

  it('never clobbers a restored setup script from saved form state', async () => {
    mocks.fetchRepoConfig.mockResolvedValue('echo repo-config');
    mocks.savedFormState = {
      repoPath: '/repo/a',
      repoType: 'local',
      isValidPath: true,
      setupScript: 'echo restored',
      setupScriptName: 'Restored',
    };

    const result = renderInitializer();
    await waitFor(() => expect(mocks.fetchRepoConfig).toHaveBeenCalledWith('/repo/a'));
    // Probe settles (spinner gone) without overwriting the restored name.
    await waitFor(() => {
      expect(result.queryByText(SPINNER_LABEL)).toBeNull();
    });
    expect(result.getByText('Restored')).toBeTruthy();
    expect(result.queryByText(REPO_CONFIG_SCRIPT_NAME)).toBeNull();
  });

  it('degrades silently to the last-used script when the repo has no config', async () => {
    mocks.lastUsedSelect.mockReturnValue({ name: 'My saved script', content: 'echo saved' });
    mocks.fetchRepoConfig.mockResolvedValue(null);
    mocks.savedFormState = { repoPath: '/repo/a', repoType: 'local', isValidPath: true };

    const result = renderInitializer();
    await waitFor(() => expect(mocks.fetchRepoConfig).toHaveBeenCalledWith('/repo/a'));
    await waitFor(() => {
      expect(result.queryByText(SPINNER_LABEL)).toBeNull();
    });
    expect(result.getByText('My saved script')).toBeTruthy();
  });

  it('re-probes with the new ref when the GitHub branch changes (monorepo#835)', async () => {
    mocks.fetchGitHubRepoConfig.mockImplementation(async (_owner, _repo, ref) =>
      ref === 'release-1.x' ? 'echo release-config' : null,
    );

    const result = renderInitializer();
    await waitFor(() => expect(pickerCallbacks()).toBeTruthy());
    // Selecting a GitHub repo probes at once (repo default branch — no ref).
    selectGitHubRepo();
    await waitFor(() => {
      expect(mocks.fetchGitHubRepoConfig).toHaveBeenCalledWith('owner', 'repo', undefined);
    });

    // Picking a branch re-probes (debounced) with the new ref and applies
    // that branch's config script.
    pickerCallbacks().onBranchChange({ detail: { branch: 'release-1.x' } });
    await waitFor(() => {
      expect(mocks.fetchGitHubRepoConfig).toHaveBeenCalledWith('owner', 'repo', 'release-1.x');
    });
    await waitFor(() => {
      expect(result.getByText(REPO_CONFIG_SCRIPT_NAME)).toBeTruthy();
    });
  });

  it('discards a stale probe result for a superseded ref after a branch change', async () => {
    const probeMain = deferred<string | null>();
    const probeRelease = deferred<string | null>();
    mocks.fetchGitHubRepoConfig.mockImplementation((_owner, _repo, ref) =>
      ref === 'main' ? probeMain.promise : probeRelease.promise,
    );
    mocks.savedFormState = {
      repoPath: '/clones/repo',
      repoType: 'github',
      githubUrl: 'https://github.com/owner/repo',
      branch: 'main',
      isValidPath: true,
    };

    const result = renderInitializer();
    await waitFor(() => {
      expect(mocks.fetchGitHubRepoConfig).toHaveBeenCalledWith('owner', 'repo', 'main');
    });

    // Change the branch while main's read is in flight, then resolve it late.
    pickerCallbacks().onBranchChange({ detail: { branch: 'release-1.x' } });
    await waitFor(() => {
      expect(mocks.fetchGitHubRepoConfig).toHaveBeenCalledWith('owner', 'repo', 'release-1.x');
    });
    probeMain.resolve('echo main-config');
    await Promise.resolve();

    // main's late result must never apply; release's own result wins.
    expect(result.queryByText(REPO_CONFIG_SCRIPT_NAME)).toBeNull();
    probeRelease.resolve('echo release-config');
    await waitFor(() => {
      expect(result.getByText(REPO_CONFIG_SCRIPT_NAME)).toBeTruthy();
    });
  });
});
