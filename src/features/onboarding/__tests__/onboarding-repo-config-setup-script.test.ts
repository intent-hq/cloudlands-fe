/**
 * @vitest-environment jsdom
 *
 * Onboarding flow must detect the repo-committed `.intent/config.json` setup
 * script the same way the New Workspace dialog does: on selecting a local
 * project it probes the repo via `fetchRepoConfigSetupScript` and defaults to
 * the "From repo config" script (priority: repo config > last-used > generic
 * template), never applying stale results after a repo switch.
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
  invoke: vi.fn(async () => ({ success: false })),
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
