/**
 * @vitest-environment jsdom
 *
 * Regression tests for the `git-tracking:get-remote-url` probe race in
 * CompactWorkspaceInitializer (reviewer finding on cloudlands-fe#443):
 * switching repos must clear the detected GitHub owner/repo synchronously
 * (no stale `(owner/repo)` suffix on the repo pill), and a late-arriving
 * probe response for a previous repoPath must never overwrite the current
 * repo's result.
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

vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-selectors', () => ({
  selectWorkspaceInitializerHydrated: () => mocks.readable(() => false),
  selectCompactWorkspaceInitializerFormState: () => mocks.readable(() => null),
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
  selectLastUsedScriptForRepo: { select: vi.fn(() => undefined) },
}));

vi.mock('$features/setup-scripts', () => ({
  SETUP_SCRIPT_TEMPLATES: [],
  getTemplateContent: vi.fn(() => ''),
  chooseDefaultSetupScript: vi.fn(() => ({ content: '', name: 'Custom' })),
  fetchRepoConfigSetupScript: vi.fn(async () => null),
  fetchGitHubRepoConfigSetupScript: vi.fn(async () => null),
  probeRepoConfigSetupScript: vi.fn(),
  repoIdentityKey: vi.fn((identity: { path: string | null }) => identity.path),
  createRepoConfigProbeScheduler: vi.fn(() => ({
    onSelectionChange: vi.fn(),
    dispose: vi.fn(),
  })),
  REPO_CONFIG_SCRIPT_NAME: 'Repo config',
}));

vi.mock('$lib/config/debug', () => ({
  debugConfig: { get: vi.fn(() => false) },
}));

vi.mock('$lib/client', () => ({
  appClient: { git: { pull: vi.fn(async () => ({ success: true })) }, drafts: {} },
}));

vi.mock('$lib/client/live/live-prompt-enhancement', () => ({
  enhancePrompt: vi.fn(async (p: string) => ({ enhanced: p })),
}));

vi.mock('$lib/utils/workspace-validation', () => ({
  getGitErrorMessage: (message: string) => message,
  parseGitHubUrl: vi.fn(() => null),
  validateBranchName: vi.fn(() => ({ valid: true })),
  validateInitialPrompt: vi.fn(() => ({ valid: true })),
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

// The component gates the remote-URL probe on `window.electronAPI` (provided
// by test-setup) and calls `invoke('git-tracking:get-remote-url')` through
// the electron bridge — route that channel to a per-test mock.
vi.mock('$lib/electron-bridge', () => ({
  isElectron: vi.fn(() => true),
  invoke: vi.fn(async (channel: string, args?: { repoPath?: string }) => {
    if (channel === 'system:check-git') {
      return { success: true, data: { available: true, version: '2.44.0' } };
    }
    if (channel === 'git-tracking:get-remote-url') {
      return mocks.getRemoteUrl(args?.repoPath ?? '');
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function remoteUrlResponse(owner: string, repo: string) {
  return { success: true, data: { owner, repo } };
}

function renderInitializer() {
  return render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
}

/** Callbacks the initializer passed to the (mocked) RepoAndBranchPicker. */
function pickerCallbacks() {
  return (
    window as unknown as {
      __mockRepoAndBranchPicker: {
        onRepoChange: (event: { detail: Record<string, unknown> }) => void;
      };
    }
  ).__mockRepoAndBranchPicker;
}

/** Drive a local repo selection through the picker's onRepoChange. */
function selectLocalRepo(path: string) {
  pickerCallbacks().onRepoChange({
    detail: { path, type: 'local', isValidPath: true },
  });
}

const textOf = (result: ReturnType<typeof renderInitializer>, testId: string) =>
  result.getByTestId(testId).textContent;

/** Flush pending microtasks and a macrotask so late promise chains settle. */
async function flush() {
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

describe('CompactWorkspaceInitializer remote-URL probe race', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.getRemoteUrl.mockResolvedValue({ success: false });
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it('shows the detected owner/repo for a local repo with a GitHub remote (happy path)', async () => {
    mocks.getRemoteUrl.mockResolvedValue(remoteUrlResponse('owner-a', 'repo-a'));

    const result = renderInitializer();
    await waitFor(() => expect(pickerCallbacks()).toBeTruthy());
    selectLocalRepo('/repo/a');

    await waitFor(() => expect(mocks.getRemoteUrl).toHaveBeenCalledWith('/repo/a'));
    await waitFor(() => {
      expect(textOf(result, 'detected-github-owner')).toBe('owner-a');
      expect(textOf(result, 'detected-github-repo')).toBe('repo-a');
    });
  });

  it('clears the detected owner/repo as soon as the repo switches (no stale suffix)', async () => {
    const probeB = deferred<unknown>();
    mocks.getRemoteUrl.mockImplementation(async (repoPath: string) =>
      repoPath === '/repo/a' ? remoteUrlResponse('owner-a', 'repo-a') : probeB.promise,
    );

    const result = renderInitializer();
    await waitFor(() => expect(pickerCallbacks()).toBeTruthy());
    selectLocalRepo('/repo/a');
    await waitFor(() => expect(textOf(result, 'detected-github-owner')).toBe('owner-a'));

    // Switch repos while B's probe is still in flight: the previous repo's
    // suffix must disappear immediately, not linger until B resolves.
    selectLocalRepo('/repo/b');
    await waitFor(() => expect(textOf(result, 'detected-github-owner')).toBe(''));
    expect(textOf(result, 'detected-github-repo')).toBe('');
  });

  it('ignores an out-of-order probe response for a superseded repo path', async () => {
    const probeA = deferred<unknown>();
    const probeB = deferred<unknown>();
    mocks.getRemoteUrl.mockImplementation((repoPath: string) =>
      repoPath === '/repo/a' ? probeA.promise : probeB.promise,
    );

    const result = renderInitializer();
    await waitFor(() => expect(pickerCallbacks()).toBeTruthy());
    selectLocalRepo('/repo/a');
    await waitFor(() => expect(mocks.getRemoteUrl).toHaveBeenCalledWith('/repo/a'));

    // Switch repos while A's probe is in flight, then resolve A late.
    selectLocalRepo('/repo/b');
    await waitFor(() => expect(mocks.getRemoteUrl).toHaveBeenCalledWith('/repo/b'));
    probeA.resolve(remoteUrlResponse('owner-a', 'repo-a'));
    await flush();

    // A's late result must be dropped, not shown for repo B.
    expect(textOf(result, 'detected-github-owner')).toBe('');
    expect(textOf(result, 'detected-github-repo')).toBe('');

    // B's own probe still applies normally.
    probeB.resolve(remoteUrlResponse('owner-b', 'repo-b'));
    await waitFor(() => expect(textOf(result, 'detected-github-owner')).toBe('owner-b'));
    expect(textOf(result, 'detected-github-repo')).toBe('repo-b');
  });
});
