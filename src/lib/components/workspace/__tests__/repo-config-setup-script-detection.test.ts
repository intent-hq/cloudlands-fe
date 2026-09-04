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
    create: vi.fn<(params: Record<string, unknown>) => Promise<unknown>>(),
  };
});

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({
      hardwareConsole: { pttRecording: false, voiceTranscribing: false },
      workspaceCreateProgress: { byProgressId: {} },
    }),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-selectors', () => ({
  selectWorkspaceInitializerHydrated: () => mocks.readable(() => false),
  selectCompactWorkspaceInitializerFormState: () => mocks.readable(() => mocks.savedFormState),
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

vi.mock('$features/setup-scripts/last-used', () => ({
  getLastUsedSetupScript: mocks.lastUsedSelect,
  recordLastUsedSetupScript: vi.fn(),
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
  workspaceClient: { create: mocks.create, update: vi.fn() },
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
import { warmImport } from '../../../../test/warm-import';

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

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('./mocks/MockRichTextarea.svelte'));
warmImport(() => import('../initializer/__tests__/mocks/MockComponent.svelte'));
warmImport(() => import('./mocks/MockRepoAndBranchPicker.svelte'));

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

  it('ignores legacy setup-script fields in saved form state (repo config wins)', async () => {
    // The setup script is session-local now: legacy persisted script fields
    // must not rehydrate, so the repo-config default applies as usual.
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
    await waitFor(() => {
      expect(result.queryByText(SPINNER_LABEL)).toBeNull();
    });
    expect(result.getByText(REPO_CONFIG_SCRIPT_NAME)).toBeTruthy();
    expect(result.queryByText('Restored')).toBeNull();
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

// The modal must keep a constant height across loading transitions: the
// setup-script pill and its trailing "script" suffix render in both loading
// and loaded states (spinner inside the pill), and the Create button's
// shortcut hint is always mounted with only its visibility toggled by form
// validity.
describe('CompactWorkspaceInitializer modal height stability', () => {
  const PILL_CLASSES = ['rounded-md', 'border', 'border-border', 'bg-background', 'px-2', 'py-0.5'];
  const SUFFIX_LABEL = 'script';

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

  it('keeps the setup-script pill and suffix rendered with the spinner inside the pill while the probe is in flight', async () => {
    const probe = deferred<string | null>();
    mocks.fetchRepoConfig.mockReturnValue(probe.promise);
    mocks.savedFormState = { repoPath: '/repo/a', repoType: 'local', isValidPath: true };

    const result = renderInitializer();
    await waitFor(() => {
      expect(result.getByText(SPINNER_LABEL)).toBeTruthy();
    });
    // The sr-only loading label (next to the spinner) sits inside the same
    // bordered pill that later shows the script name, and the trailing
    // "script" suffix stays mounted so the row structure never changes.
    const loadingPill = result.getByText(SPINNER_LABEL).parentElement;
    expect(loadingPill).toBeTruthy();
    for (const cls of PILL_CLASSES) {
      expect(loadingPill!.classList.contains(cls)).toBe(true);
    }
    const loadingSuffix = result.getByText(SUFFIX_LABEL);

    probe.resolve('echo repo-config');
    await waitFor(() => {
      expect(result.getByText(REPO_CONFIG_SCRIPT_NAME)).toBeTruthy();
    });
    const loadedPill = result.getByText(REPO_CONFIG_SCRIPT_NAME);
    for (const cls of PILL_CLASSES) {
      expect(loadedPill.classList.contains(cls)).toBe(true);
    }
    // Same suffix node across the transition — it is never unmounted.
    expect(result.getByText(SUFFIX_LABEL)).toBe(loadingSuffix);
  });

  it('never remounts the shortcut hint span on a validity flip — visibility only', async () => {
    // Single render: start invalid (no repo selected) with the hint mounted
    // but invisible, reserving its space so the button never resizes.
    const result = renderInitializer();
    const hint = result.getByText(/↵/);
    expect(hint.classList.contains('invisible')).toBe(true);
    expect(hint.getAttribute('aria-hidden')).toBe('true');

    // Flip the form to valid by driving the picker callbacks.
    await waitFor(() => expect(pickerCallbacks()).toBeTruthy());
    pickerCallbacks().onRepoChange({
      detail: { path: '/repo/a', type: 'local', isValidPath: true },
    });
    pickerCallbacks().onBranchChange({ detail: { branch: 'main' } });

    await waitFor(() => {
      expect(result.getByText(/↵/).classList.contains('invisible')).toBe(false);
    });
    // Element identity preserved: the span was toggled, not remounted.
    const visibleHint = result.getByText(/↵/);
    expect(visibleHint).toBe(hint);
    expect(visibleHint.getAttribute('aria-hidden')).toBeNull();
  });
});

describe('CompactWorkspaceInitializer setupScript on workspace.create (monorepo#1862)', () => {
  const PREFILL_KEY = 'workspace-prefill';

  /** Seed the auto-create prefill so the reactive $effect submits the form. */
  function seedAutoCreatePrefill() {
    sessionStorage.setItem(
      PREFILL_KEY,
      JSON.stringify({
        repoPath: '/repo/a',
        branch: 'main',
        prompt: 'Build the thing',
        autoCreate: true,
      }),
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.savedFormState = null;
    mocks.lastUsedSelect.mockReturnValue(undefined);
    mocks.fetchRepoConfig.mockResolvedValue(null);
    mocks.fetchGitHubRepoConfig.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ ok: false, error: 'stop after payload capture' });
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it('sends the auto-restored last-used default (the shown script is what runs)', async () => {
    // Last-used script restored synchronously on repo selection — it is
    // shown in the form, so it is sent.
    mocks.lastUsedSelect.mockReturnValue({ name: 'My saved script', content: 'echo saved' });

    seedAutoCreatePrefill();
    const { component } = renderInitializer();
    await component.applyPrefill();

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    const request = mocks.create.mock.calls[0][0] as Record<string, unknown>;
    expect(request.setupScript).toBe('echo saved');
  });

  it('omits setupScript for the unedited repo-config script', async () => {
    mocks.fetchRepoConfig.mockResolvedValue('echo repo-config');

    seedAutoCreatePrefill();
    const { component, getByText } = renderInitializer();
    await component.applyPrefill();
    await waitFor(() => expect(getByText(REPO_CONFIG_SCRIPT_NAME)).toBeTruthy());

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    const request = mocks.create.mock.calls[0][0] as Record<string, unknown>;
    expect(request.setupScript).toBeUndefined();
  });

  it('awaits an in-flight probe at submit instead of racing it', async () => {
    const probe = deferred<string | null>();
    mocks.fetchRepoConfig.mockReturnValue(probe.promise);

    seedAutoCreatePrefill();
    const { component } = renderInitializer();
    await component.applyPrefill();
    await waitFor(() => expect(mocks.fetchRepoConfig).toHaveBeenCalledWith('/repo/a'));

    // Create is gated on the probe settling.
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.create).not.toHaveBeenCalled();

    probe.resolve('echo repo-config');
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    const request = mocks.create.mock.calls[0][0] as Record<string, unknown>;
    expect(request.setupScript).toBeUndefined();
  });
});
