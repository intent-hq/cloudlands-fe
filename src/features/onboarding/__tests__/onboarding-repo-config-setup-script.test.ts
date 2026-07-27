/**
 * @vitest-environment jsdom
 *
 * Onboarding flow must detect the repo-committed `.intent/config.json` setup
 * script the same way the New Workspace dialog does: on selecting a local
 * project it probes the repo via `fetchRepoConfigSetupScript` and defaults to
 * the "From repo config" script (priority: repo config > last-used > generic
 * template), never applying stale results after a repo switch. GitHub
 * selections also re-probe (debounced) when the branch changes (monorepo#835),
 * discarding results for superseded refs.
 *
 * Also covers the onboarding-side `git-tracking:get-remote-url` probe race
 * (reviewer finding on cloudlands-fe#443): switching repos clears the
 * detected GitHub owner/repo immediately, and late responses for a previous
 * path never apply.
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
    fetchRepoConfig: vi.fn<(repoPath: string) => Promise<string | null>>(),
    fetchGitHubRepoConfig:
      vi.fn<(owner: string, repo: string, ref?: string) => Promise<string | null>>(),
    lastUsedSelect: vi.fn(),
    getRemoteUrl: vi.fn<(repoPath: string) => Promise<unknown>>(),
  };
});

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({ state: () => ({}), dispatch: mocks.dispatch });
});

vi.mock('$store/renderer/slices/onboarding/onboarding-selectors', () => ({
  selectOnboardingStep: () => mocks.readable(() => 'configuring'),
  selectOnboardingState: () => mocks.readable(() => ({ step: 'configuring' })),
}));

vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-selectors', () => ({
  selectWorkspaceInitializerHydrated: () => mocks.readable(() => false),
}));

vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticating: { select: vi.fn(() => false) },
}));

vi.mock('$store/renderer/slices/setup-scripts/setup-scripts-selectors', () => ({
  selectLastUsedScriptForRepo: { select: mocks.lastUsedSelect },
}));

// Keep the real priority logic (chooseDefaultSetupScript, templates, name
// constant); only the IPC/daemon-backed probes are stubbed. Mock the deep
// module (not the barrel) so the shared probe helper's relative import of
// './repo-config' resolves to the same stubs.
vi.mock('$features/setup-scripts/repo-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$features/setup-scripts/repo-config')>()),
  fetchRepoConfigSetupScript: mocks.fetchRepoConfig,
  fetchGitHubRepoConfigSetupScript: mocks.fetchGitHubRepoConfig,
}));

vi.mock('$shared/generated/ipc-client', () => ({
  invoke: vi.fn(async (channel: string, args?: { repoPath?: string }) => {
    if (channel === 'git-tracking:get-remote-url') {
      return mocks.getRemoteUrl(args?.repoPath ?? '');
    }
    return { success: false };
  }),
}));

vi.mock('$lib/client', () => ({
  appClient: { git: { pull: vi.fn(async () => ({ success: true })) } },
}));

vi.mock('$lib/client/live/live-prompt-enhancement', () => ({
  enhancePrompt: vi.fn(async (p: string) => ({ enhanced: p })),
}));

vi.mock('svelte-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('$features/onboarding/utils/resolve-onboarding-model', () => ({
  resolveOnboardingModel: vi.fn(async () => ({ provider: 'auggie', model: 'model' })),
}));

vi.mock('$features/onboarding/utils/parse-context-references', () => ({
  parseContextMentions: vi.fn(() => []),
  parseFileMentions: vi.fn(() => []),
  parseRuntimeMentions: vi.fn(async () => []),
  parseInlineImages: vi.fn(() => []),
  extractLinearIssue: vi.fn(() => undefined),
  extractSentryIssue: vi.fn(() => undefined),
}));

vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: vi.fn(() => ({ clearLayout: vi.fn() })),
}));

vi.mock('$store/renderer/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { create: vi.fn(), update: vi.fn() },
}));

vi.mock('$features/onboarding/steps/OnboardingPromptStep.svelte', async () => ({
  default: (await import('./mocks/MockOnboardingPromptStep.svelte')).default,
}));

vi.mock('$features/onboarding/steps/OnboardingGitHubStep.svelte', async () => ({
  default: (await import('$lib/components/workspace/initializer/__tests__/mocks/MockComponent.svelte'))
    .default,
}));

vi.mock('$features/onboarding/messages/WorkspaceSetupCard.svelte', async () => ({
  default: (await import('$lib/components/workspace/initializer/__tests__/mocks/MockComponent.svelte'))
    .default,
}));

vi.mock('$features/onboarding/messages/ProjectPickerMessage.svelte', async () => ({
  default: (await import('$lib/components/workspace/initializer/__tests__/mocks/MockComponent.svelte'))
    .default,
}));

vi.mock('$features/onboarding/messages/AgentGrid.svelte', async () => ({
  default: (await import('$lib/components/workspace/initializer/__tests__/mocks/MockComponent.svelte'))
    .default,
}));

vi.mock('$lib/components/modals/PullConflictDialog.svelte', async () => ({
  default: (await import('$lib/components/workspace/initializer/__tests__/mocks/MockComponent.svelte'))
    .default,
}));

vi.mock('$lib/components/ui/RichTextarea.svelte', async () => ({
  default: (await import('$lib/components/workspace/__tests__/mocks/MockRichTextarea.svelte'))
    .default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/workspace/initializer/__tests__/mocks/MockComponent.svelte'))
    .default,
}));

import OnboardingPage from '../OnboardingPage.svelte';
import { REPO_CONFIG_SCRIPT_NAME, SETUP_SCRIPT_TEMPLATES } from '$features/setup-scripts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function renderPage() {
  return render(OnboardingPage, {
    props: {
      isOnboarding: true,
      fadingOut: false,
      onHoldActiveChange: vi.fn(),
      onFadingOutChange: vi.fn(),
    },
  });
}

/** Drive repo selection through the captured onProjectChange prop. */
function selectLocalRepo(repoPath: string) {
  const captured = (
    window as unknown as {
      __mockOnboardingPromptStep: { onProjectChange: (selection: unknown) => void };
    }
  ).__mockOnboardingPromptStep;
  captured.onProjectChange({
    type: 'local',
    repoPath,
    branch: 'main',
    isValid: true,
  });
}

/** Drive a GitHub-type selection (URL, no local checkout). */
function selectGitHubRepo(overrides: Record<string, unknown> = {}) {
  const captured = (
    window as unknown as {
      __mockOnboardingPromptStep: { onProjectChange: (selection: unknown) => void };
    }
  ).__mockOnboardingPromptStep;
  captured.onProjectChange({
    type: 'github',
    repoPath: '/clones/repo',
    githubUrl: 'https://github.com/owner/repo',
    branch: 'main',
    isValid: true,
    ...overrides,
  });
}

const textOf = (result: ReturnType<typeof renderPage>, testId: string) =>
  result.getByTestId(testId).textContent;

describe('onboarding repo-config setup script detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.lastUsedSelect.mockReturnValue(undefined);
    mocks.fetchRepoConfig.mockResolvedValue(null);
    mocks.fetchGitHubRepoConfig.mockResolvedValue(null);
    mocks.getRemoteUrl.mockResolvedValue({ success: false });
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it('defaults to "From repo config" when the repo commits a setupScript', async () => {
    // A last-used script exists too — repo config must win the priority.
    mocks.lastUsedSelect.mockReturnValue({ name: 'My saved script', content: 'echo saved' });
    mocks.fetchRepoConfig.mockResolvedValue('echo repo-config');

    const result = renderPage();
    selectLocalRepo('/repo/a');

    await waitFor(() => {
      expect(textOf(result, 'setup-script-name')).toBe(REPO_CONFIG_SCRIPT_NAME);
    });
    expect(mocks.fetchRepoConfig).toHaveBeenCalledWith('/repo/a');
    expect(textOf(result, 'setup-script')).toBe('echo repo-config');
    expect(textOf(result, 'is-custom-setup-script')).toBe('false');
    // Cached script is forwarded so SetupScriptModal renders the list entry.
    expect(textOf(result, 'repo-config-script')).toBe('echo repo-config');
  });

  it('falls back to the last-used script when the repo has no config', async () => {
    mocks.lastUsedSelect.mockReturnValue({ name: 'My saved script', content: 'echo saved' });
    mocks.fetchRepoConfig.mockResolvedValue(null);

    const result = renderPage();
    selectLocalRepo('/repo/a');

    await waitFor(() => {
      expect(textOf(result, 'setup-script-name')).toBe('My saved script');
    });
    expect(textOf(result, 'setup-script')).toBe('echo saved');
    expect(textOf(result, 'repo-config-script')).toBe('');
  });

  it('falls back to the generic template when neither repo config nor last-used exists', async () => {
    const generic = SETUP_SCRIPT_TEMPLATES.find((t) => t.id === 'generic')!;

    const result = renderPage();
    selectLocalRepo('/repo/a');

    await waitFor(() => {
      expect(textOf(result, 'setup-script-name')).toBe(generic.name);
    });
    expect(textOf(result, 'repo-config-script')).toBe('');
  });

  it('probes GitHub selections via github.repoConfig.get with the selected branch as ref', async () => {
    mocks.fetchGitHubRepoConfig.mockResolvedValue('echo gh-config');

    const result = renderPage();
    selectGitHubRepo({ branch: 'release-1.x' });

    await waitFor(() => {
      expect(textOf(result, 'setup-script-name')).toBe(REPO_CONFIG_SCRIPT_NAME);
    });
    expect(mocks.fetchRepoConfig).not.toHaveBeenCalled();
    expect(mocks.fetchGitHubRepoConfig).toHaveBeenCalledWith('owner', 'repo', 'release-1.x');
    expect(textOf(result, 'setup-script')).toBe('echo gh-config');
    expect(textOf(result, 'repo-config-script')).toBe('echo gh-config');
    // Probe resolved — spinner is gone.
    expect(textOf(result, 'is-repo-config-loading')).toBe('false');
  });

  it('omits ref for a GitHub selection without a branch yet', async () => {
    renderPage();
    selectGitHubRepo({ branch: '' });

    await waitFor(() => {
      expect(mocks.fetchGitHubRepoConfig).toHaveBeenCalledWith('owner', 'repo', undefined);
    });
  });

  it('shows the loading state while the GitHub probe is in flight, then degrades silently on no config', async () => {
    const probe = deferred<string | null>();
    mocks.fetchGitHubRepoConfig.mockReturnValue(probe.promise);

    const result = renderPage();
    selectGitHubRepo();

    await waitFor(() => {
      expect(textOf(result, 'is-repo-config-loading')).toBe('true');
    });

    probe.resolve(null);
    await waitFor(() => {
      expect(textOf(result, 'is-repo-config-loading')).toBe('false');
    });
    // No config → current default behavior (generic template), no repo-config entry.
    const generic = SETUP_SCRIPT_TEMPLATES.find((t) => t.id === 'generic')!;
    expect(textOf(result, 'setup-script-name')).toBe(generic.name);
    expect(textOf(result, 'repo-config-script')).toBe('');
  });

  it('does not probe remote selections', async () => {
    const result = renderPage();
    const captured = (
      window as unknown as {
        __mockOnboardingPromptStep: { onProjectChange: (selection: unknown) => void };
      }
    ).__mockOnboardingPromptStep;
    captured.onProjectChange({
      type: 'new',
      repoPath: '/projects/new-thing',
      branch: 'main',
      isValid: true,
    });

    await waitFor(() => {
      expect(textOf(result, 'setup-script-name')).not.toBe('Custom');
    });
    expect(mocks.fetchRepoConfig).not.toHaveBeenCalled();
    expect(mocks.fetchGitHubRepoConfig).not.toHaveBeenCalled();
  });

  it('discards a stale probe result after the user switches repos', async () => {
    mocks.lastUsedSelect.mockImplementation((_state: unknown, repo: string) =>
      repo === '/repo/b' ? { name: 'B saved script', content: 'echo b-saved' } : undefined,
    );
    const probeA = deferred<string | null>();
    const probeB = deferred<string | null>();
    mocks.fetchRepoConfig.mockImplementation(async (repoPath: string) =>
      repoPath === '/repo/a' ? probeA.promise : probeB.promise,
    );

    const result = renderPage();
    selectLocalRepo('/repo/a');
    await waitFor(() => expect(mocks.fetchRepoConfig).toHaveBeenCalledWith('/repo/a'));

    // Switch repos while A's read is still in flight, then resolve A late.
    selectLocalRepo('/repo/b');
    await waitFor(() => expect(mocks.fetchRepoConfig).toHaveBeenCalledWith('/repo/b'));
    probeA.resolve('echo a-script');
    await Promise.resolve();

    // A's late result must be dropped: state stays on B's last-used default
    // and A's script is never cached for the modal.
    await waitFor(() => {
      expect(textOf(result, 'setup-script-name')).toBe('B saved script');
    });
    expect(textOf(result, 'setup-script')).toBe('echo b-saved');
    expect(textOf(result, 'repo-config-script')).toBe('');

    // B's own probe still applies normally.
    probeB.resolve('echo b-config');
    await waitFor(() => {
      expect(textOf(result, 'setup-script-name')).toBe(REPO_CONFIG_SCRIPT_NAME);
    });
    expect(textOf(result, 'setup-script')).toBe('echo b-config');
    expect(textOf(result, 'repo-config-script')).toBe('echo b-config');
  });

  it('discards a stale GitHub probe result after switching to a local repo', async () => {
    mocks.lastUsedSelect.mockImplementation((_state: unknown, repo: string) =>
      repo === '/repo/local' ? { name: 'Local saved', content: 'echo local-saved' } : undefined,
    );
    const ghProbe = deferred<string | null>();
    mocks.fetchGitHubRepoConfig.mockReturnValue(ghProbe.promise);

    const result = renderPage();
    selectGitHubRepo();
    await waitFor(() => expect(mocks.fetchGitHubRepoConfig).toHaveBeenCalled());

    // Switch to a local repo while the GitHub read is in flight, then resolve late.
    selectLocalRepo('/repo/local');
    await waitFor(() => expect(mocks.fetchRepoConfig).toHaveBeenCalledWith('/repo/local'));
    ghProbe.resolve('echo gh-config');
    await Promise.resolve();

    await waitFor(() => {
      expect(textOf(result, 'setup-script-name')).toBe('Local saved');
    });
    expect(textOf(result, 'setup-script')).toBe('echo local-saved');
    expect(textOf(result, 'repo-config-script')).toBe('');
  });

  it('re-probes with the new ref when the GitHub branch changes (monorepo#835)', async () => {
    mocks.fetchGitHubRepoConfig.mockImplementation(async (_owner, _repo, ref) =>
      ref === 'release-1.x' ? 'echo release-config' : 'echo main-config',
    );

    const result = renderPage();
    selectGitHubRepo({ branch: 'main' });
    await waitFor(() => {
      expect(mocks.fetchGitHubRepoConfig).toHaveBeenCalledWith('owner', 'repo', 'main');
    });
    await waitFor(() => {
      expect(textOf(result, 'setup-script')).toBe('echo main-config');
    });

    // Same repo, new branch — re-probes (debounced) with the new ref.
    selectGitHubRepo({ branch: 'release-1.x' });
    await waitFor(() => {
      expect(mocks.fetchGitHubRepoConfig).toHaveBeenCalledWith('owner', 'repo', 'release-1.x');
    });
    await waitFor(() => {
      expect(textOf(result, 'setup-script')).toBe('echo release-config');
    });
    expect(textOf(result, 'setup-script-name')).toBe(REPO_CONFIG_SCRIPT_NAME);
    expect(textOf(result, 'repo-config-script')).toBe('echo release-config');
  });

  it('re-probes the repo default when the branch is cleared', async () => {
    renderPage();
    selectGitHubRepo({ branch: 'main' });
    await waitFor(() => {
      expect(mocks.fetchGitHubRepoConfig).toHaveBeenCalledWith('owner', 'repo', 'main');
    });

    selectGitHubRepo({ branch: '' });
    await waitFor(() => {
      expect(mocks.fetchGitHubRepoConfig).toHaveBeenCalledWith('owner', 'repo', undefined);
    });
  });

  it('discards a stale probe result for a superseded ref after a branch change', async () => {
    const probeMain = deferred<string | null>();
    const probeRelease = deferred<string | null>();
    mocks.fetchGitHubRepoConfig.mockImplementation((_owner, _repo, ref) =>
      ref === 'main' ? probeMain.promise : probeRelease.promise,
    );

    const result = renderPage();
    selectGitHubRepo({ branch: 'main' });
    await waitFor(() => {
      expect(mocks.fetchGitHubRepoConfig).toHaveBeenCalledWith('owner', 'repo', 'main');
    });

    // Change the branch while main's read is in flight, then resolve it late.
    selectGitHubRepo({ branch: 'release-1.x' });
    await waitFor(() => {
      expect(mocks.fetchGitHubRepoConfig).toHaveBeenCalledWith('owner', 'repo', 'release-1.x');
    });
    probeMain.resolve('echo main-config');
    await Promise.resolve();

    // main's late result must never apply or cache; release's own result wins.
    expect(textOf(result, 'setup-script')).not.toBe('echo main-config');
    probeRelease.resolve('echo release-config');
    await waitFor(() => {
      expect(textOf(result, 'setup-script')).toBe('echo release-config');
    });
    expect(textOf(result, 'repo-config-script')).toBe('echo release-config');
  });

  it('does not re-probe local repos when the branch changes', async () => {
    renderPage();
    selectLocalRepo('/repo/a');
    await waitFor(() => expect(mocks.fetchRepoConfig).toHaveBeenCalledWith('/repo/a'));
    expect(mocks.fetchRepoConfig).toHaveBeenCalledTimes(1);

    const captured = (
      window as unknown as {
        __mockOnboardingPromptStep: { onProjectChange: (selection: unknown) => void };
      }
    ).__mockOnboardingPromptStep;
    captured.onProjectChange({ type: 'local', repoPath: '/repo/a', branch: 'other', isValid: true });

    // Debounce window elapses with no further request.
    await new Promise((r) => setTimeout(r, 400));
    expect(mocks.fetchRepoConfig).toHaveBeenCalledTimes(1);
    expect(mocks.fetchGitHubRepoConfig).not.toHaveBeenCalled();
  });

  it('re-probes and discards stale results when two GitHub repos share a clone path', async () => {
    const probeA = deferred<string | null>();
    const probeB = deferred<string | null>();
    mocks.fetchGitHubRepoConfig.mockImplementation(async (owner: string) =>
      owner === 'owner-a' ? probeA.promise : probeB.promise,
    );

    const result = renderPage();
    // Both selections use the same clone destination path.
    selectGitHubRepo({ githubUrl: 'https://github.com/owner-a/repo', branch: '' });
    await waitFor(() =>
      expect(mocks.fetchGitHubRepoConfig).toHaveBeenCalledWith('owner-a', 'repo', undefined),
    );

    // Switching repo identity (same path, different URL) must trigger a new probe.
    selectGitHubRepo({ githubUrl: 'https://github.com/owner-b/repo', branch: '' });
    await waitFor(() =>
      expect(mocks.fetchGitHubRepoConfig).toHaveBeenCalledWith('owner-b', 'repo', undefined),
    );

    // A's late result must be dropped even though the path still matches.
    probeA.resolve('echo a-config');
    await Promise.resolve();
    probeB.resolve('echo b-config');
    await waitFor(() => {
      expect(textOf(result, 'setup-script-name')).toBe(REPO_CONFIG_SCRIPT_NAME);
    });
    expect(textOf(result, 'setup-script')).toBe('echo b-config');
    expect(textOf(result, 'repo-config-script')).toBe('echo b-config');
  });
});

describe('onboarding remote-URL probe race (cloudlands-fe#443)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.lastUsedSelect.mockReturnValue(undefined);
    mocks.fetchRepoConfig.mockResolvedValue(null);
    mocks.fetchGitHubRepoConfig.mockResolvedValue(null);
    mocks.getRemoteUrl.mockResolvedValue({ success: false });
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  const remoteUrlResponse = (owner: string, repo: string) => ({
    success: true,
    data: { owner, repo },
  });

  /** Flush pending microtasks and a macrotask so late promise chains settle. */
  async function flush() {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }

  it('shows the detected owner/repo for a local repo with a GitHub remote (happy path)', async () => {
    mocks.getRemoteUrl.mockResolvedValue(remoteUrlResponse('owner-a', 'repo-a'));

    const result = renderPage();
    selectLocalRepo('/repo/a');

    await waitFor(() => expect(mocks.getRemoteUrl).toHaveBeenCalledWith('/repo/a'));
    await waitFor(() => expect(textOf(result, 'github-repo-info')).toContain('owner-a/repo-a'));
  });

  it('clears the detected owner/repo as soon as the repo switches (no stale suffix)', async () => {
    const probeB = deferred<unknown>();
    mocks.getRemoteUrl.mockImplementation(async (repoPath: string) =>
      repoPath === '/repo/a' ? remoteUrlResponse('owner-a', 'repo-a') : probeB.promise,
    );

    const result = renderPage();
    selectLocalRepo('/repo/a');
    await waitFor(() => expect(textOf(result, 'github-repo-info')).toContain('owner-a/repo-a'));

    // Switch repos while B's probe is still in flight: the previous repo's
    // owner/repo must disappear immediately, not linger until B resolves.
    selectLocalRepo('/repo/b');
    await waitFor(() => expect(textOf(result, 'github-repo-info')?.trim()).toBe(''));
  });

  it('ignores an out-of-order probe response for a superseded repo path', async () => {
    const probeA = deferred<unknown>();
    const probeB = deferred<unknown>();
    mocks.getRemoteUrl.mockImplementation((repoPath: string) =>
      repoPath === '/repo/a' ? probeA.promise : probeB.promise,
    );

    const result = renderPage();
    selectLocalRepo('/repo/a');
    await waitFor(() => expect(mocks.getRemoteUrl).toHaveBeenCalledWith('/repo/a'));

    // Switch repos while A's probe is in flight, then resolve A late.
    selectLocalRepo('/repo/b');
    await waitFor(() => expect(mocks.getRemoteUrl).toHaveBeenCalledWith('/repo/b'));
    probeA.resolve(remoteUrlResponse('owner-a', 'repo-a'));
    await flush();

    // A's late result must be dropped, not shown for repo B.
    expect(textOf(result, 'github-repo-info')?.trim()).toBe('');

    // B's own probe still applies normally.
    probeB.resolve(remoteUrlResponse('owner-b', 'repo-b'));
    await waitFor(() => expect(textOf(result, 'github-repo-info')).toContain('owner-b/repo-b'));
  });
});
