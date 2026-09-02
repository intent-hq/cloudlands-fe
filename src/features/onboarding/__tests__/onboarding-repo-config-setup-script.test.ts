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
 *
 * Also covers the onboarding `workspace.create` wire request shape: the
 * picked-repo payloads (githubUrl vs repositoryPath) and the live clone
 * progress correlation — a minted `progressId` registered in the
 * workspaceCreateProgress slice before the create goes out, echoed on the
 * request (PROTOCOL §5.1), and cleared once the create settles.
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
    workspaceCreate: vi.fn<(params: Record<string, unknown>) => Promise<unknown>>(),
    toastError: vi.fn(),
    gitPull: vi.fn(async () => ({ success: true })),
    // Default implementation survives vi.clearAllMocks(); model-pick tests
    // override per-call behavior with mockImplementation.
    resolveModel: vi.fn(async (_state: unknown, _userSelectedModel?: string) => ({
      provider: 'auggie',
      model: 'model',
      behaviorPrompt: undefined,
      specialistId: 'spec-writer',
    })),
    redeemStagedAttachments: vi.fn(async (_workspaceId: string, items: unknown[]) => ({
      items,
      failedCount: 0,
      fileBlocks: [],
    })),
    sendHeldFirstMessage: vi.fn(async () => ({ sent: true })),
    // Mutable workspace-initializer state for the model-pick tests
    initializerHydrated: false,
    persistedOnboardingFormState: null as Record<string, unknown> | null,
    // Store-visible active provider for the submit-time default commit
    // (selectActiveProviderId reads state.model.defaultProviderId).
    activeProviderId: '',
  };
});

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ model: { defaultProviderId: mocks.activeProviderId } }),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/onboarding/onboarding-selectors', () => ({
  selectOnboardingStep: () => mocks.readable(() => 'configuring'),
  selectOnboardingState: () => mocks.readable(() => ({ step: 'configuring' })),
  selectOnboardingFullFlowRequested: Object.assign(() => mocks.readable(() => false), {
    select: () => false,
  }),
}));

vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-selectors', () => ({
  selectWorkspaceInitializerHydrated: () => mocks.readable(() => mocks.initializerHydrated),
  selectWorkspaceInitializerOnboardingFormState: {
    select: () => mocks.persistedOnboardingFormState,
  },
}));

vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticating: { select: vi.fn(() => false) },
}));

vi.mock('$features/setup-scripts/last-used', () => ({
  getLastUsedSetupScript: mocks.lastUsedSelect,
  recordLastUsedSetupScript: vi.fn(),
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
  appClient: { git: { pull: mocks.gitPull } },
}));

vi.mock('$lib/client/live/live-prompt-enhancement', () => ({
  enhancePrompt: vi.fn(async (p: string) => ({ enhanced: p })),
  isEnhancePromptAvailable: vi.fn(() => true),
}));

vi.mock('svelte-sonner', () => ({
  toast: { success: vi.fn(), error: mocks.toastError },
}));

vi.mock('$features/onboarding/utils/resolve-onboarding-model', () => ({
  resolveOnboardingModel: mocks.resolveModel,
}));

// Keep the real pure mention parsers (the #4050 regression test asserts
// mention-derived context references reach the held payload); only the
// runtime parser — which pulls in the terminal manager — is stubbed.
vi.mock('$features/onboarding/utils/parse-context-references', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$features/onboarding/utils/parse-context-references')>()),
  parseRuntimeMentions: vi.fn(async () => []),
}));

vi.mock('$lib/components/workspace/initializer/staged-attachments', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('$lib/components/workspace/initializer/staged-attachments')
  >()),
  redeemStagedAttachments: mocks.redeemStagedAttachments,
  sendHeldFirstMessage: mocks.sendHeldFirstMessage,
}));

vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: vi.fn(() => ({ clearLayout: vi.fn() })),
}));

vi.mock('$store/renderer/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { create: mocks.workspaceCreate, update: vi.fn() },
}));

vi.mock('$features/onboarding/steps/OnboardingPromptStep.svelte', async () => ({
  default: (await import('./mocks/MockOnboardingPromptStep.svelte')).default,
}));

vi.mock('$features/onboarding/steps/OnboardingGitHubStep.svelte', async () => ({
  default: (
    await import('$lib/components/workspace/initializer/__tests__/mocks/MockComponent.svelte')
  ).default,
}));

vi.mock('$features/onboarding/messages/WorkspaceSetupCard.svelte', async () => ({
  default: (
    await import('$lib/components/workspace/initializer/__tests__/mocks/MockComponent.svelte')
  ).default,
}));

vi.mock('$features/onboarding/messages/ProjectPickerMessage.svelte', async () => ({
  default: (
    await import('$lib/components/workspace/initializer/__tests__/mocks/MockComponent.svelte')
  ).default,
}));

vi.mock('$features/onboarding/messages/AgentGrid.svelte', async () => ({
  default: (
    await import('$lib/components/workspace/initializer/__tests__/mocks/MockComponent.svelte')
  ).default,
}));

vi.mock('$lib/components/modals/PullConflictDialog.svelte', async () => ({
  default: (
    await import('$lib/components/workspace/initializer/__tests__/mocks/MockComponent.svelte')
  ).default,
}));

vi.mock('$lib/components/ui/RichTextarea.svelte', async () => ({
  default: (await import('$lib/components/workspace/__tests__/mocks/MockRichTextarea.svelte'))
    .default,
}));

vi.mock('svelte-fa', async () => ({
  default: (
    await import('$lib/components/workspace/initializer/__tests__/mocks/MockComponent.svelte')
  ).default,
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

/** Drive a GitHub-type selection (picked repo: owner/repo shorthand, no local checkout). */
function selectGitHubRepo(overrides: Record<string, unknown> = {}) {
  const captured = (
    window as unknown as {
      __mockOnboardingPromptStep: { onProjectChange: (selection: unknown) => void };
    }
  ).__mockOnboardingPromptStep;
  captured.onProjectChange({
    type: 'github',
    repoPath: 'owner/repo',
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
    // The row localizes via the name's true identity, not string matching.
    expect(textOf(result, 'setup-script-name-source')).toBe('repo-config');
    expect(textOf(result, 'setup-script')).toBe('echo repo-config');
    expect(textOf(result, 'is-custom-setup-script')).toBe('false');
    // Cached script is forwarded so SetupScriptModal renders the list entry.
    expect(textOf(result, 'repo-config-script')).toBe('echo repo-config');
    // Unedited repo-config default applies silently — no disclosure row.
    expect(textOf(result, 'hide-setup-script-control')).toBe('true');
  });

  it('does not pull a behind source checkout for isolated creation', async () => {
    mocks.workspaceCreate.mockResolvedValue({ ok: false, error: 'stop after payload capture' });
    renderPage();
    selectLocalRepo('/repo/a');
    const captured = (
      window as unknown as {
        __mockOnboardingPromptStep: {
          setBranchBehind: (behind: number) => void;
          setInputValue: (value: string) => void;
          onSubmit: () => void;
        };
      }
    ).__mockOnboardingPromptStep;
    captured.setBranchBehind(2);
    captured.setInputValue('build the thing');
    captured.onSubmit();

    await waitFor(() => expect(mocks.workspaceCreate).toHaveBeenCalledTimes(1));
    expect(mocks.gitPull).not.toHaveBeenCalled();
  });

  it('pulls a behind source checkout before direct creation', async () => {
    mocks.workspaceCreate.mockResolvedValue({ ok: false, error: 'stop after payload capture' });
    renderPage();
    selectLocalRepo('/repo/a');
    const captured = (
      window as unknown as {
        __mockOnboardingPromptStep: {
          setSkipIsolation: (value: boolean) => void;
          setBranchBehind: (behind: number) => void;
          setInputValue: (value: string) => void;
          onSubmit: () => void;
        };
      }
    ).__mockOnboardingPromptStep;
    captured.setSkipIsolation(true);
    captured.setBranchBehind(2);
    captured.setInputValue('build the thing');
    captured.onSubmit();

    await waitFor(() => expect(mocks.workspaceCreate).toHaveBeenCalledTimes(1));
    expect(mocks.gitPull).toHaveBeenCalledWith('/repo/a', 'main');
    expect(mocks.gitPull.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.workspaceCreate.mock.invocationCallOrder[0],
    );
  });

  it('falls back to the last-used script when the repo has no config', async () => {
    mocks.lastUsedSelect.mockReturnValue({ name: 'My saved script', content: 'echo saved' });
    mocks.fetchRepoConfig.mockResolvedValue(null);

    const result = renderPage();
    selectLocalRepo('/repo/a');

    await waitFor(() => {
      expect(textOf(result, 'setup-script-name')).toBe('My saved script');
    });
    // A saved script's user-chosen name passes through display unlocalized.
    expect(textOf(result, 'setup-script-name-source')).toBe('named');
    expect(textOf(result, 'setup-script')).toBe('echo saved');
    expect(textOf(result, 'repo-config-script')).toBe('');
    // No repo config — the disclosure row stays visible.
    await waitFor(() => {
      expect(textOf(result, 'hide-setup-script-control')).toBe('false');
    });
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
    // Repo-config default applied silently — the control stays hidden.
    expect(textOf(result, 'hide-setup-script-control')).toBe('true');
  });

  it('omits ref for a GitHub selection without a branch yet', async () => {
    renderPage();
    selectGitHubRepo({ branch: '' });

    await waitFor(() => {
      expect(mocks.fetchGitHubRepoConfig).toHaveBeenCalledWith('owner', 'repo', undefined);
    });
  });

  it('hides the setup-script control while the GitHub probe is in flight, then shows it on no config', async () => {
    const probe = deferred<string | null>();
    mocks.fetchGitHubRepoConfig.mockReturnValue(probe.promise);

    const result = renderPage();
    selectGitHubRepo();

    await waitFor(() => {
      expect(textOf(result, 'hide-setup-script-control')).toBe('true');
    });

    probe.resolve(null);
    await waitFor(() => {
      expect(textOf(result, 'hide-setup-script-control')).toBe('false');
    });
    // No config → current default behavior (generic template), no repo-config entry.
    const generic = SETUP_SCRIPT_TEMPLATES.find((t) => t.id === 'generic')!;
    expect(textOf(result, 'setup-script-name')).toBe(generic.name);
    expect(textOf(result, 'repo-config-script')).toBe('');
  });

  it('shows the setup-script control again once the repo-config script is edited', async () => {
    mocks.fetchRepoConfig.mockResolvedValue('echo repo-config');

    const result = renderPage();
    selectLocalRepo('/repo/a');
    await waitFor(() => {
      expect(textOf(result, 'setup-script')).toBe('echo repo-config');
    });
    expect(textOf(result, 'hide-setup-script-control')).toBe('true');

    // Only the unedited repo-config default is silent — a customized script
    // must surface the disclosure row.
    const captured = (
      window as unknown as {
        __mockOnboardingPromptStep: { setSetupScript: (value: string) => void };
      }
    ).__mockOnboardingPromptStep;
    captured.setSetupScript('echo repo-config && echo edited');
    await waitFor(() => {
      expect(textOf(result, 'hide-setup-script-control')).toBe('false');
    });
  });

  it('omits setupScript on workspace.create for the unedited repo-config script (monorepo#1862)', async () => {
    // The committed .intent/config.json is the source of truth: re-sending it
    // would make the daemon rewrite the tracked file; omitting it still
    // executes the committed script via the worktree-first read (§5.1).
    mocks.fetchRepoConfig.mockResolvedValue('echo repo-config');
    mocks.workspaceCreate.mockResolvedValue({ ok: false, error: 'stop after payload capture' });

    const result = renderPage();
    selectLocalRepo('/repo/a');
    await waitFor(() => {
      expect(textOf(result, 'setup-script')).toBe('echo repo-config');
    });
    expect(textOf(result, 'hide-setup-script-control')).toBe('true');

    const captured = (
      window as unknown as {
        __mockOnboardingPromptStep: {
          onSubmit: () => void;
          setInputValue: (value: string) => void;
        };
      }
    ).__mockOnboardingPromptStep;
    captured.setInputValue('build the thing');
    captured.onSubmit();

    await waitFor(() => expect(mocks.workspaceCreate).toHaveBeenCalled());
    const request = mocks.workspaceCreate.mock.calls[0][0];
    expect(request.setupScript).toBeUndefined();
  });

  it('sends the auto-restored default (the shown script is what runs)', async () => {
    // No repo config — the form falls back to the generic template. The
    // shown script is what runs, so it is sent as-is.
    mocks.fetchRepoConfig.mockResolvedValue(null);
    mocks.workspaceCreate.mockResolvedValue({ ok: false, error: 'stop after payload capture' });
    const generic = SETUP_SCRIPT_TEMPLATES.find((t) => t.id === 'generic')!;

    const result = renderPage();
    selectLocalRepo('/repo/a');
    await waitFor(() => {
      expect(textOf(result, 'setup-script-name')).toBe(generic.name);
    });
    const shownScript = textOf(result, 'setup-script');
    expect(shownScript).not.toBe('');

    const captured = (
      window as unknown as {
        __mockOnboardingPromptStep: {
          onSubmit: () => void;
          setInputValue: (value: string) => void;
        };
      }
    ).__mockOnboardingPromptStep;
    captured.setInputValue('build the thing');
    captured.onSubmit();

    await waitFor(() => expect(mocks.workspaceCreate).toHaveBeenCalled());
    const request = mocks.workspaceCreate.mock.calls[0][0];
    expect(request.setupScript).toBe(shownScript?.trim());
  });

  it('sends setupScript when the user committed an edited script via the modal', async () => {
    mocks.fetchRepoConfig.mockResolvedValue('echo repo-config');
    mocks.workspaceCreate.mockResolvedValue({ ok: false, error: 'stop after payload capture' });

    const result = renderPage();
    selectLocalRepo('/repo/a');
    await waitFor(() => {
      expect(textOf(result, 'setup-script')).toBe('echo repo-config');
    });

    const captured = (
      window as unknown as {
        __mockOnboardingPromptStep: {
          onSubmit: () => void;
          setInputValue: (value: string) => void;
          commitSetupScript: (value: string, isCustom?: boolean) => void;
        };
      }
    ).__mockOnboardingPromptStep;
    captured.commitSetupScript('echo repo-config && echo edited');
    captured.setInputValue('build the thing');
    captured.onSubmit();

    await waitFor(() => expect(mocks.workspaceCreate).toHaveBeenCalled());
    expect(mocks.workspaceCreate).toHaveBeenCalledWith(
      expect.objectContaining({ setupScript: 'echo repo-config && echo edited' }),
    );
  });

  it('mints a progressId, registers it before create, sends it on the wire, and clears it on settle', async () => {
    // Live clone progress: the FE mints a correlation id, registers the slice
    // entry BEFORE workspace.create (so mid-flight git:clone:progress frames
    // find it), echoes it as `progressId` on the create request (PROTOCOL
    // §5.1), and drops the entry once the create settles.
    mocks.workspaceCreate.mockResolvedValue({ ok: false, error: 'stop after payload capture' });

    renderPage();
    selectLocalRepo('/repo/a');

    const captured = (
      window as unknown as {
        __mockOnboardingPromptStep: {
          onSubmit: () => void;
          setInputValue: (value: string) => void;
        };
      }
    ).__mockOnboardingPromptStep;
    captured.setInputValue('build the thing');
    captured.onSubmit();

    await waitFor(() => expect(mocks.workspaceCreate).toHaveBeenCalled());
    const request = mocks.workspaceCreate.mock.calls[0][0] as { progressId?: string };
    expect(typeof request.progressId).toBe('string');
    expect(request.progressId).not.toBe('');

    const actions = mocks.dispatch.mock.calls.map(
      ([action]) => action as { type: string; payload?: unknown[] },
    );
    const begin = actions.find((a) => a.type === 'workspaceCreateProgress/begin');
    expect(begin?.payload).toEqual([request.progressId]);
    // begin must be dispatched before the create request goes out.
    const beginIndex = mocks.dispatch.mock.calls.findIndex(
      ([action]) => (action as { type: string }).type === 'workspaceCreateProgress/begin',
    );
    expect(beginIndex).toBeGreaterThanOrEqual(0);
    expect(mocks.workspaceCreate.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.dispatch.mock.invocationCallOrder[beginIndex],
    );
    // The create settled (failure here) — the entry is dropped.
    await waitFor(() => {
      const clear = mocks.dispatch.mock.calls
        .map(([action]) => action as { type: string; payload?: unknown[] })
        .find((a) => a.type === 'workspaceCreateProgress/clear');
      expect(clear?.payload).toEqual([request.progressId]);
    });
  });

  it('submits a picked-repo create with its detected non-main branch', async () => {
    // Picked-repo flow: the daemon hydrates the checkout from its repo
    // cache. The create request must carry the GitHub URL and MUST NOT
    // carry a local repositoryPath or any clonePath (the selection's
    // repoPath is the owner/repo shorthand, not a local path).
    mocks.workspaceCreate.mockResolvedValue({ ok: false, error: 'stop after payload capture' });

    renderPage();
    selectGitHubRepo({ branch: 'master' });

    const captured = (
      window as unknown as {
        __mockOnboardingPromptStep: {
          onSubmit: () => void;
          setInputValue: (value: string) => void;
        };
      }
    ).__mockOnboardingPromptStep;
    captured.setInputValue('build the thing');
    captured.onSubmit();

    await waitFor(() => expect(mocks.workspaceCreate).toHaveBeenCalled());
    const request = mocks.workspaceCreate.mock.calls[0][0];
    expect(request.githubUrl).toBe('https://github.com/owner/repo');
    expect(request.repositoryPath).toBeUndefined();
    expect(request).not.toHaveProperty('clonePath');
    expect(request.baseRef).toBe('master');
  });

  it('explains blocked submission until an existing-repo branch resolves, then creates with it', async () => {
    mocks.workspaceCreate.mockResolvedValue({ ok: false, error: 'stop after payload capture' });

    renderPage();
    selectGitHubRepo({ branch: '' });

    const captured = (
      window as unknown as {
        __mockOnboardingPromptStep: {
          onProjectChange: (selection: unknown) => void;
          onSubmit: () => void;
          setInputValue: (value: string) => void;
        };
      }
    ).__mockOnboardingPromptStep;
    captured.setInputValue('build the thing');
    captured.onSubmit();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.toastError).toHaveBeenCalledWith('Select a branch before creating the workspace');
    expect(mocks.resolveModel).not.toHaveBeenCalled();
    expect(mocks.workspaceCreate).not.toHaveBeenCalled();

    captured.onProjectChange({
      type: 'github',
      repoPath: 'owner/repo',
      githubUrl: 'https://github.com/owner/repo',
      branch: 'master',
      isValid: true,
    });
    captured.onSubmit();

    await waitFor(() => expect(mocks.workspaceCreate).toHaveBeenCalledTimes(1));
    expect(mocks.workspaceCreate.mock.calls[0][0].baseRef).toBe('master');
  });

  it('awaits an in-flight probe at submit and never sends the racing generic template (monorepo#1862)', async () => {
    // Probe still in flight when the user submits: create must wait for it,
    // see the repo-config script applied, and omit setupScript — not send the
    // synchronously-restored generic template.
    const probe = deferred<string | null>();
    mocks.fetchRepoConfig.mockReturnValue(probe.promise);
    mocks.workspaceCreate.mockResolvedValue({ ok: false, error: 'stop after payload capture' });

    renderPage();
    selectLocalRepo('/repo/a');
    await waitFor(() => expect(mocks.fetchRepoConfig).toHaveBeenCalledWith('/repo/a'));

    const captured = (
      window as unknown as {
        __mockOnboardingPromptStep: {
          onSubmit: () => void;
          setInputValue: (value: string) => void;
        };
      }
    ).__mockOnboardingPromptStep;
    captured.setInputValue('build the thing');
    captured.onSubmit();

    // Create is gated on the probe.
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.workspaceCreate).not.toHaveBeenCalled();

    probe.resolve('echo repo-config');
    await waitFor(() => expect(mocks.workspaceCreate).toHaveBeenCalled());
    const request = mocks.workspaceCreate.mock.calls[0][0];
    expect(request.setupScript).toBeUndefined();
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
    mocks.lastUsedSelect.mockImplementation((repo: string) =>
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
    mocks.lastUsedSelect.mockImplementation((repo: string) =>
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
    captured.onProjectChange({
      type: 'local',
      repoPath: '/repo/a',
      branch: 'other',
      isValid: true,
    });

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

  it('keeps the detected owner/repo and does not re-probe on a branch-only selection change (#447 follow-up)', async () => {
    // First probe resolves; any accidental re-probe would hang forever, so a
    // buggy clear+re-probe leaves the suffix blank instead of flickering back.
    mocks.getRemoteUrl
      .mockImplementationOnce(async () => remoteUrlResponse('owner-a', 'repo-a'))
      .mockImplementation(() => new Promise(() => {}));

    const result = renderPage();
    selectLocalRepo('/repo/a');
    await waitFor(() => expect(textOf(result, 'github-repo-info')).toContain('owner-a/repo-a'));
    expect(mocks.getRemoteUrl).toHaveBeenCalledTimes(1);

    // Branch-only change: same repo path and type, different branch.
    const captured = (
      window as unknown as {
        __mockOnboardingPromptStep: { onProjectChange: (selection: unknown) => void };
      }
    ).__mockOnboardingPromptStep;
    captured.onProjectChange({
      type: 'local',
      repoPath: '/repo/a',
      branch: 'other',
      isValid: true,
    });
    await flush();

    // The suffix must persist (no blank/flicker) and the probe must not re-run.
    expect(textOf(result, 'github-repo-info')).toContain('owner-a/repo-a');
    expect(mocks.getRemoteUrl).toHaveBeenCalledTimes(1);
  });
});

describe('onboarding model picker (initial Coordinator agent)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.lastUsedSelect.mockReturnValue(undefined);
    mocks.fetchRepoConfig.mockResolvedValue(null);
    mocks.fetchGitHubRepoConfig.mockResolvedValue(null);
    mocks.getRemoteUrl.mockResolvedValue({ success: false });
    // clearAllMocks keeps implementations — pin the default explicitly so a
    // per-test mockImplementation never leaks into the next test.
    mocks.resolveModel.mockImplementation(async () => ({
      provider: 'auggie',
      model: 'model',
      behaviorPrompt: undefined,
      specialistId: 'spec-writer',
    }));
    mocks.initializerHydrated = false;
    mocks.persistedOnboardingFormState = null;
    mocks.activeProviderId = '';
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    mocks.initializerHydrated = false;
    mocks.persistedOnboardingFormState = null;
    mocks.activeProviderId = '';
  });

  const captured = () =>
    (
      window as unknown as {
        __mockOnboardingPromptStep: {
          onModelChange: (model: string) => void;
          onSubmit: () => void;
          setInputValue: (value: string) => void;
          setEffectiveDefaultModel: (value: {
            model: string | undefined;
            provider: string;
          }) => void;
        };
      }
    ).__mockOnboardingPromptStep;

  const dispatchedActions = () =>
    mocks.dispatch.mock.calls.map(([action]) => action as { type: string; payload?: unknown[] });

  it('dispatches the global selectModel trigger when the user picks a model', async () => {
    const result = renderPage();
    selectLocalRepo('/repo/a');

    captured().onModelChange('pi:anthropic/claude-opus-4.7');
    await waitFor(() => {
      expect(textOf(result, 'selected-model')).toBe('pi:anthropic/claude-opus-4.7');
    });
    expect(textOf(result, 'model-was-overridden')).toBe('true');

    const selectModelAction = dispatchedActions().find((a) => a.type === 'model/selectModel');
    expect(selectModelAction).toBeDefined();
    expect(selectModelAction?.payload).toEqual(['pi:anthropic/claude-opus-4.7']);
  });

  it('persists the pick in the debounced onboarding form state', async () => {
    mocks.initializerHydrated = true;

    renderPage();
    selectLocalRepo('/repo/a');
    captured().onModelChange('pi:anthropic/claude-opus-4.7');

    await waitFor(() => {
      const persistActions = dispatchedActions().filter(
        (a) => a.type === 'workspaceInitializer/debounceOnboardingFormState',
      );
      const last = persistActions[persistActions.length - 1];
      const formState = last?.payload?.[0] as Record<string, unknown> | undefined;
      expect(formState?.selectedModel).toBe('pi:anthropic/claude-opus-4.7');
      expect(formState?.modelWasOverridden).toBe(true);
    });
  });

  it('restores a persisted mid-onboarding pick after hydration', async () => {
    mocks.initializerHydrated = true;
    mocks.persistedOnboardingFormState = {
      projectSelection: null,
      selectedModel: 'pi:anthropic/claude-opus-4.7',
      modelWasOverridden: true,
      step: 'configuring',
    };

    const result = renderPage();

    await waitFor(() => {
      expect(textOf(result, 'selected-model')).toBe('pi:anthropic/claude-opus-4.7');
    });
    expect(textOf(result, 'model-was-overridden')).toBe('true');
  });

  it('threads the pick through resolveOnboardingModel into workspace.create initialAgent', async () => {
    const PICKED = 'pi:anthropic/claude-opus-4.7';
    mocks.resolveModel.mockImplementation(async (_state, userSelectedModel) => ({
      provider: userSelectedModel ? 'pi' : 'auggie',
      model: userSelectedModel ?? 'opus4.7',
      behaviorPrompt: 'coordinator-prompt',
      specialistId: 'spec-writer',
    }));
    mocks.workspaceCreate.mockResolvedValue({
      ok: true,
      data: {
        workspace: {
          id: 'ws-1',
          path: '/repo/a',
          repositoryPath: '/repo/a',
          worktreePath: '/wt/a',
        },
        initialAgent: { id: 'agent-1' },
      },
    });

    renderPage();
    selectLocalRepo('/repo/a');
    captured().onModelChange(PICKED);
    captured().setInputValue('Build the thing');
    captured().onSubmit();

    await waitFor(() => expect(mocks.workspaceCreate).toHaveBeenCalledTimes(1));
    expect(mocks.resolveModel).toHaveBeenCalledWith(expect.anything(), PICKED);
    const createRequest = mocks.workspaceCreate.mock.calls[0][0] as {
      initialAgent: { model: string; provider: string; specialist: string };
    };
    expect(createRequest.initialAgent.model).toBe(PICKED);
    expect(createRequest.initialAgent.provider).toBe('pi');
    expect(createRequest.initialAgent.specialist).toBe('spec-writer');
  });

  it('resolves without an override when the user never picked a model', async () => {
    mocks.workspaceCreate.mockResolvedValue({
      ok: true,
      data: {
        workspace: {
          id: 'ws-1',
          path: '/repo/a',
          repositoryPath: '/repo/a',
          worktreePath: '/wt/a',
        },
        initialAgent: { id: 'agent-1' },
      },
    });

    renderPage();
    selectLocalRepo('/repo/a');
    captured().setInputValue('Build the thing');
    captured().onSubmit();

    await waitFor(() => expect(mocks.workspaceCreate).toHaveBeenCalledTimes(1));
    expect(mocks.resolveModel).toHaveBeenCalledWith(expect.anything(), undefined);
    const createRequest = mocks.workspaceCreate.mock.calls[0][0] as {
      initialAgent: { model: string; provider: string };
    };
    expect(createRequest.initialAgent.model).toBe('model');
    expect(createRequest.initialAgent.provider).toBe('auggie');
  });

  const okCreateResult = {
    ok: true,
    data: {
      workspace: {
        id: 'ws-1',
        path: '/repo/a',
        repositoryPath: '/repo/a',
        worktreePath: '/wt/a',
      },
      initialAgent: { id: 'agent-1' },
    },
  };

  it('commits the default (never-touched) selection at submit: provider + compound model (monorepo#3044)', async () => {
    mocks.resolveModel.mockImplementation(async () => ({
      provider: 'auggie',
      model: undefined,
      behaviorPrompt: undefined,
      specialistId: 'spec-writer',
    }));
    mocks.workspaceCreate.mockResolvedValue(okCreateResult);

    renderPage();
    selectLocalRepo('/repo/a');
    captured().setEffectiveDefaultModel({ model: 'opus4.7', provider: 'auggie' });
    captured().setInputValue('Build the thing');
    captured().onSubmit();

    await waitFor(() => expect(mocks.workspaceCreate).toHaveBeenCalledTimes(1));
    const actions = dispatchedActions();
    expect(actions.find((a) => a.type === 'providerSettings/setProviderEnabled')?.payload).toEqual([
      { providerId: 'auggie', enabled: true },
    ]);
    expect(actions.find((a) => a.type === 'providerSettings/setActiveProvider')?.payload).toEqual([
      'auggie',
    ]);
    // Bare preview id gets the resolved provider's compound prefix.
    expect(actions.find((a) => a.type === 'model/selectModel')?.payload).toEqual([
      'auggie:opus4.7',
    ]);
  });

  it('commits only the provider when no default-model preview resolved ("Provider default")', async () => {
    mocks.resolveModel.mockImplementation(async () => ({
      provider: 'auggie',
      model: undefined,
      behaviorPrompt: undefined,
      specialistId: 'spec-writer',
    }));
    mocks.workspaceCreate.mockResolvedValue(okCreateResult);

    renderPage();
    selectLocalRepo('/repo/a');
    captured().setEffectiveDefaultModel({ model: undefined, provider: 'auggie' });
    captured().setInputValue('Build the thing');
    captured().onSubmit();

    await waitFor(() => expect(mocks.workspaceCreate).toHaveBeenCalledTimes(1));
    const actions = dispatchedActions();
    expect(actions.find((a) => a.type === 'providerSettings/setActiveProvider')?.payload).toEqual([
      'auggie',
    ]);
    expect(actions.find((a) => a.type === 'model/selectModel')).toBeUndefined();
  });

  it('does not trust a preview resolved under a different provider context', async () => {
    mocks.resolveModel.mockImplementation(async () => ({
      provider: 'auggie',
      model: undefined,
      behaviorPrompt: undefined,
      specialistId: 'spec-writer',
    }));
    mocks.workspaceCreate.mockResolvedValue(okCreateResult);

    renderPage();
    selectLocalRepo('/repo/a');
    captured().setEffectiveDefaultModel({ model: 'gpt-5.3-codex', provider: 'codex' });
    captured().setInputValue('Build the thing');
    captured().onSubmit();

    await waitFor(() => expect(mocks.workspaceCreate).toHaveBeenCalledTimes(1));
    const actions = dispatchedActions();
    expect(actions.find((a) => a.type === 'providerSettings/setActiveProvider')?.payload).toEqual([
      'auggie',
    ]);
    expect(actions.find((a) => a.type === 'model/selectModel')).toBeUndefined();
  });

  it('does not re-commit the provider at submit after an explicit pick (no double-dispatch)', async () => {
    const PICKED = 'pi:anthropic/claude-opus-4.7';
    mocks.resolveModel.mockImplementation(async (_state, userSelectedModel) => ({
      provider: userSelectedModel ? 'pi' : 'auggie',
      model: userSelectedModel,
      behaviorPrompt: undefined,
      specialistId: 'spec-writer',
    }));
    mocks.workspaceCreate.mockResolvedValue(okCreateResult);

    renderPage();
    selectLocalRepo('/repo/a');
    captured().onModelChange(PICKED);
    // The pick-time dispatch already persisted — the submit path must not
    // dispatch a second commit for the explicit pick.
    mocks.dispatch.mockClear();
    captured().setInputValue('Build the thing');
    captured().onSubmit();

    await waitFor(() => expect(mocks.workspaceCreate).toHaveBeenCalledTimes(1));
    const actions = dispatchedActions();
    expect(actions.find((a) => a.type === 'model/selectModel')).toBeUndefined();
    expect(actions.find((a) => a.type === 'providerSettings/setActiveProvider')).toBeUndefined();
  });

  it('commits nothing when create is aborted by a resolution failure', async () => {
    mocks.resolveModel.mockImplementation(async () => {
      throw new Error('provider unavailable');
    });

    renderPage();
    selectLocalRepo('/repo/a');
    captured().setEffectiveDefaultModel({ model: 'opus4.7', provider: 'auggie' });
    captured().setInputValue('Build the thing');
    captured().onSubmit();

    await waitFor(() => expect(mocks.resolveModel).toHaveBeenCalledTimes(1));
    expect(mocks.workspaceCreate).not.toHaveBeenCalled();
    const actions = dispatchedActions();
    expect(actions.find((a) => a.type === 'model/selectModel')).toBeUndefined();
    expect(actions.find((a) => a.type === 'providerSettings/setActiveProvider')).toBeUndefined();
  });
});

describe('onboarding first-message attachments (intent-hq/intent#4050)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.lastUsedSelect.mockReturnValue(undefined);
    mocks.fetchRepoConfig.mockResolvedValue(null);
    mocks.fetchGitHubRepoConfig.mockResolvedValue(null);
    mocks.getRemoteUrl.mockResolvedValue({ success: false });
    mocks.resolveModel.mockImplementation(async () => ({
      provider: 'auggie',
      model: 'model',
      behaviorPrompt: undefined,
      specialistId: 'spec-writer',
    }));
    mocks.redeemStagedAttachments.mockImplementation(async (_workspaceId, items) => ({
      items,
      failedCount: 0,
      fileBlocks: [],
    }));
    mocks.sendHeldFirstMessage.mockImplementation(async () => ({ sent: true }));
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  const captured = () =>
    (
      window as unknown as {
        __mockOnboardingPromptStep: {
          onSubmit: () => void;
          setInputValue: (value: string) => void;
          setImageContextItems: (items: unknown[]) => void;
          setStagedContextItems: (items: unknown[]) => void;
          setEditorMentions: (mentions: unknown[], contextMentions: unknown[]) => void;
        };
      }
    ).__mockOnboardingPromptStep;

  it('regression: image context items and editor mentions ride the held first message even though the editor is unmounted mid-submit', async () => {
    // The mock prompt step's getRichTextarea() goes null the moment
    // isOnboardingCreating flips — the same editor-gone condition the real
    // page creates mid-submit. Images must come from the context-item
    // state, and mentions must be snapshotted BEFORE the flip: reading
    // either after the awaits would return nothing (intent-hq/intent#4050).
    mocks.workspaceCreate.mockResolvedValue({
      ok: true,
      data: {
        workspace: {
          id: 'ws-1',
          path: '/repo/a',
          repositoryPath: '/repo/a',
          worktreePath: '/wt/a',
        },
        initialAgent: { id: 'agent-1' },
      },
    });

    renderPage();
    selectLocalRepo('/repo/a');
    captured().setImageContextItems([
      {
        id: 'image-1',
        type: 'file',
        label: 'screenshot.png',
        imageData: 'iVBORw0KGgoAAAANSUhEUg==',
        imageMimeType: 'image/png',
      },
    ]);
    captured().setEditorMentions(
      [{ type: 'file', label: 'src/main.ts', meta: { fullPath: '/repo/a/src/main.ts' } }],
      [],
    );
    captured().setInputValue('Build the thing');
    captured().onSubmit();

    await waitFor(() => expect(mocks.workspaceCreate).toHaveBeenCalledTimes(1));
    // Images force the held path: no prompt/imageBlocks on the create frame.
    const createRequest = mocks.workspaceCreate.mock.calls[0][0] as {
      initialAgent: { prompt?: string; imageBlocks?: unknown };
    };
    expect(createRequest.initialAgent.prompt).toBeUndefined();
    expect(createRequest.initialAgent.imageBlocks).toBeUndefined();

    // The held first message carries the image blocks built from the
    // context items AND the mention-derived context references snapshotted
    // before the editor unmounted.
    await waitFor(() => expect(mocks.sendHeldFirstMessage).toHaveBeenCalledTimes(1));
    const [heldParams] = mocks.sendHeldFirstMessage.mock.calls[0] as [
      {
        content: string;
        imageBlocks: Array<{ type: string; data: string; mimeType: string }>;
        contextReferences: Array<{ type: string; path?: string; title?: string }>;
      },
    ];
    expect(heldParams.content).toBe('Build the thing');
    expect(heldParams.imageBlocks).toEqual([
      { type: 'image', data: 'iVBORw0KGgoAAAANSUhEUg==', mimeType: 'image/png' },
    ]);
    expect(heldParams.contextReferences).toEqual([
      { type: 'file', path: '/repo/a/src/main.ts', title: 'src/main.ts' },
    ]);
  });

  it('rebuilds imageBlocks from the current thumbnail state on retry, not the pending snapshot', async () => {
    // First held send fails → onboardingPendingSend arms the retry. The
    // thumbnails stay editable, so a removed image must not ride the retry.
    mocks.workspaceCreate.mockResolvedValue({
      ok: true,
      data: {
        workspace: {
          id: 'ws-1',
          path: '/repo/a',
          repositoryPath: '/repo/a',
          worktreePath: '/wt/a',
        },
        initialAgent: { id: 'agent-1' },
      },
    });
    mocks.sendHeldFirstMessage
      .mockImplementationOnce(async () => ({ sent: false }))
      .mockImplementation(async () => ({ sent: true }));

    const imageA = {
      id: 'image-a',
      type: 'file',
      label: 'a.png',
      imageData: 'AAAA',
      imageMimeType: 'image/png',
    };
    const imageB = {
      id: 'image-b',
      type: 'file',
      label: 'b.png',
      imageData: 'BBBB',
      imageMimeType: 'image/png',
    };

    renderPage();
    selectLocalRepo('/repo/a');
    captured().setImageContextItems([imageA, imageB]);
    captured().setInputValue('Build the thing');
    captured().onSubmit();

    await waitFor(() => expect(mocks.sendHeldFirstMessage).toHaveBeenCalledTimes(1));
    expect(mocks.workspaceCreate).toHaveBeenCalledTimes(1);

    // User removes one thumbnail, then presses Create again (the retry).
    captured().setImageContextItems([imageB]);
    captured().onSubmit();

    await waitFor(() => expect(mocks.sendHeldFirstMessage).toHaveBeenCalledTimes(2));
    // The retry resumed the pending send — no second workspace.
    expect(mocks.workspaceCreate).toHaveBeenCalledTimes(1);
    const [retryParams] = mocks.sendHeldFirstMessage.mock.calls[1] as [
      {
        content: string;
        imageBlocks: Array<{ type: string; data: string; mimeType: string }>;
      },
    ];
    expect(retryParams.content).toBe('Build the thing');
    expect(retryParams.imageBlocks).toEqual([
      { type: 'image', data: 'BBBB', mimeType: 'image/png' },
    ]);
  });

  it('sends the prompt on the create frame when no attachments are staged', async () => {
    mocks.workspaceCreate.mockResolvedValue({
      ok: true,
      data: {
        workspace: {
          id: 'ws-1',
          path: '/repo/a',
          repositoryPath: '/repo/a',
          worktreePath: '/wt/a',
        },
        initialAgent: { id: 'agent-1' },
      },
    });

    renderPage();
    selectLocalRepo('/repo/a');
    captured().setInputValue('Build the thing');
    captured().onSubmit();

    await waitFor(() => expect(mocks.workspaceCreate).toHaveBeenCalledTimes(1));
    const createRequest = mocks.workspaceCreate.mock.calls[0][0] as {
      initialAgent: { prompt?: string };
    };
    expect(createRequest.initialAgent.prompt).toBe('Build the thing');
    expect(mocks.sendHeldFirstMessage).not.toHaveBeenCalled();
  });

  it('folder-only staging rides the create frame as an absolute-path context reference', async () => {
    // A staged folder is path-only (never placed), so it does NOT force the
    // held path: the prompt and the folder-derived context reference go out
    // on the workspace.create frame itself.
    mocks.workspaceCreate.mockResolvedValue({
      ok: true,
      data: {
        workspace: {
          id: 'ws-1',
          path: '/repo/a',
          repositoryPath: '/repo/a',
          worktreePath: '/wt/a',
        },
        initialAgent: { id: 'agent-1' },
      },
    });

    renderPage();
    selectLocalRepo('/repo/a');
    captured().setStagedContextItems([
      {
        id: 'staged-folder-/home/user/projects/data',
        type: 'folder',
        label: 'data',
        path: '/home/user/projects/data',
      },
    ]);
    captured().setInputValue('Analyze the data');
    captured().onSubmit();

    await waitFor(() => expect(mocks.workspaceCreate).toHaveBeenCalledTimes(1));
    const createRequest = mocks.workspaceCreate.mock.calls[0][0] as {
      initialAgent: {
        prompt?: string;
        contextReferences?: Array<{ type: string; path?: string; title?: string }>;
      };
    };
    expect(createRequest.initialAgent.prompt).toBe('Analyze the data');
    expect(createRequest.initialAgent.contextReferences).toEqual([
      { type: 'file', path: '/home/user/projects/data', title: 'data' },
    ]);
    expect(mocks.sendHeldFirstMessage).not.toHaveBeenCalled();
  });

  it('mixed staging (folder + file) delivers the folder reference on the held first message', async () => {
    // A staged non-image FILE forces the held path; the folder's absolute
    // path must ride the held send's contextReferences, not be dropped.
    mocks.workspaceCreate.mockResolvedValue({
      ok: true,
      data: {
        workspace: {
          id: 'ws-1',
          path: '/repo/a',
          repositoryPath: '/repo/a',
          worktreePath: '/wt/a',
        },
        initialAgent: { id: 'agent-1' },
      },
    });

    renderPage();
    selectLocalRepo('/repo/a');
    captured().setStagedContextItems([
      {
        id: 'staged-folder-/home/user/projects/data',
        type: 'folder',
        label: 'data',
        path: '/home/user/projects/data',
      },
      {
        id: 'staged-file-1721650000000-0',
        type: 'file',
        label: 'notes.txt',
        path: 'notes.txt',
        sourcePath: '/home/user/notes.txt',
      },
    ]);
    captured().setInputValue('Build the thing');
    captured().onSubmit();

    await waitFor(() => expect(mocks.workspaceCreate).toHaveBeenCalledTimes(1));
    // The staged file holds the prompt and references off the create frame.
    const createRequest = mocks.workspaceCreate.mock.calls[0][0] as {
      initialAgent: { prompt?: string; contextReferences?: unknown };
    };
    expect(createRequest.initialAgent.prompt).toBeUndefined();
    expect(createRequest.initialAgent.contextReferences).toBeUndefined();

    await waitFor(() => expect(mocks.sendHeldFirstMessage).toHaveBeenCalledTimes(1));
    const [heldParams] = mocks.sendHeldFirstMessage.mock.calls[0] as [
      {
        content: string;
        contextReferences: Array<{ type: string; path?: string; title?: string }>;
      },
    ];
    expect(heldParams.content).toBe('Build the thing');
    expect(heldParams.contextReferences).toEqual([
      { type: 'file', path: '/home/user/projects/data', title: 'data' },
    ]);
  });
});
