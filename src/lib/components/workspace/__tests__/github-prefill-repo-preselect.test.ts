/**
 * @vitest-environment jsdom
 *
 * Integration tests for GitHub-prefill repo preselection through
 * CompactWorkspaceInitializer with mock IPC: consuming a pending issue/PR
 * prefill preselects the recent repo whose git remote (probed via
 * `git-tracking:get-remote-url`) matches the link's owner/repo, falls back to
 * the GitHub clone flow when nothing matches, and keeps the current repo when
 * probing errors.
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
    pendingPrefill: null as unknown,
    prefillSubscribers: new Set<(value: unknown) => void>(),
    recentRepos: [] as unknown[],
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
  selectCompactWorkspaceInitializerFormState: () => mocks.readable(() => null),
  selectWorkspaceInitializerLastSelectedRepo: () => mocks.readable(() => null),
  selectWorkspaceInitializerLastSubmittedAgent: () => mocks.readable(() => null),
  selectWorkspaceInitializerRecentRepos: () => mocks.readable(() => mocks.recentRepos),
  // Live readable: tracks subscribers so tests can push a second prefill
  selectWorkspaceInitializerPendingGitHubPrefill: () => ({
    subscribe(run: (value: unknown) => void) {
      run(mocks.pendingPrefill);
      mocks.prefillSubscribers.add(run);
      return () => mocks.prefillSubscribers.delete(run);
    },
  }),
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
  isEnhancePromptAvailable: vi.fn(() => true),
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

// Route the electron-bridge `git-tracking:get-remote-url` probe (used both by
// the detected-suffix effect and the prefill repo matcher) to a per-test mock.
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

// Mirror the real resolver's IssueSelectionData-shaped return (see
// github-prefill.ts / github-prefill.test.ts) so contract breaks between the
// resolver and handleIssueSelect aren't masked by a drifting mock shape.
vi.mock('$lib/components/workspace/initializer/github-prefill', () => ({
  resolveGitHubPrefillSelection: vi.fn(
    async (prefill: {
      owner: string;
      repo: string;
      number: number;
      kind: string;
      url: string;
    }) => ({
      type: 'github' as const,
      identifier: `${prefill.owner}/${prefill.repo}#${prefill.number}`,
      title: `#${prefill.number}`,
      url: prefill.url,
      metadata: { project: `${prefill.owner}/${prefill.repo}` },
    }),
  ),
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
import { resolveGitHubPrefillSelection } from '$lib/components/workspace/initializer/github-prefill';
import { warmImport } from '../../../../test/warm-import';

function remoteUrlResponse(owner: string, repo: string) {
  return { success: true, data: { owner, repo } };
}

/** Set the pending prefill and notify live subscribers (simulates a new dispatch). */
function pushPrefill(value: unknown) {
  mocks.pendingPrefill = value;
  for (const run of mocks.prefillSubscribers) run(value);
}

/**
 * Mirror the real reducer for the clear action: the component clears the
 * pending prefill before consuming it, and the live selector must reflect
 * that (otherwise a later effect re-run would re-consume a stale prefill,
 * which cannot happen against the real store).
 */
function emulateClearPrefillReducer() {
  mocks.dispatch.mockImplementation((action: { type?: string }) => {
    if (action?.type === 'workspaceInitializer/clearPendingGitHubPrefill') {
      pushPrefill(null);
    }
  });
}

function renderInitializer() {
  return render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
}

const textOf = (result: ReturnType<typeof renderInitializer>, testId: string) =>
  result.getByTestId(testId).textContent;

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('./mocks/MockRichTextarea.svelte'));
warmImport(() => import('../initializer/__tests__/mocks/MockComponent.svelte'));
warmImport(() => import('./mocks/MockRepoAndBranchPicker.svelte'));

describe('CompactWorkspaceInitializer GitHub-prefill repo preselection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.pendingPrefill = null;
    mocks.prefillSubscribers.clear();
    mocks.recentRepos = [];
    mocks.getRemoteUrl.mockResolvedValue({ success: false });
    emulateClearPrefillReducer();
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it('preselects the recent repo whose probed remote matches the prefill owner/repo', async () => {
    mocks.pendingPrefill = {
      owner: 'intent-hq',
      repo: 'monorepo',
      number: 42,
      kind: 'issue',
      url: 'https://github.com/intent-hq/monorepo/issues/42',
    };
    mocks.recentRepos = [
      { path: '/repos/other', type: 'local', name: 'other' },
      { path: '/repos/monorepo', type: 'local', name: 'monorepo' },
    ];
    mocks.getRemoteUrl.mockImplementation(async (repoPath: string) =>
      repoPath === '/repos/monorepo'
        ? remoteUrlResponse('intent-hq', 'monorepo')
        : { success: false },
    );

    const result = renderInitializer();
    await waitFor(() => {
      expect(textOf(result, 'picker-repo-path')).toBe('/repos/monorepo');
      expect(textOf(result, 'picker-repo-type')).toBe('local');
    });
  });

  it('preselects via stored recent-repo owner metadata without probing that repo', async () => {
    mocks.pendingPrefill = {
      owner: 'intent-hq',
      repo: 'monorepo',
      number: 7,
      kind: 'pr',
      url: 'https://github.com/intent-hq/monorepo/pull/7',
    };
    mocks.recentRepos = [
      { path: '/repos/monorepo', type: 'local', name: 'monorepo', owner: 'intent-hq' },
    ];

    const result = renderInitializer();
    await waitFor(() => expect(textOf(result, 'picker-repo-path')).toBe('/repos/monorepo'));
  });

  it('falls back to the GitHub clone flow when no local repo matches', async () => {
    mocks.pendingPrefill = {
      owner: 'intent-hq',
      repo: 'monorepo',
      number: 3,
      kind: 'issue',
      url: 'https://github.com/intent-hq/monorepo/issues/3',
    };
    mocks.recentRepos = [{ path: '/repos/other', type: 'local', name: 'other' }];

    const result = renderInitializer();
    await waitFor(() => {
      expect(textOf(result, 'picker-repo-type')).toBe('github');
      expect(textOf(result, 'picker-github-url')).toBe('https://github.com/intent-hq/monorepo');
      expect(textOf(result, 'picker-repo-path')).toBe('~/Developer/monorepo');
    });
  });

  it('drops a stale in-flight prefill when a second one arrives (second wins)', async () => {
    // First prefill's repo match hangs on a remote probe; the second resolves
    // instantly via stored metadata. Releasing the first probe afterwards must
    // not flip the repo selection back or insert the first mention.
    let releaseFirstProbe!: (value: unknown) => void;
    const firstProbe = new Promise((resolve) => {
      releaseFirstProbe = resolve;
    });
    mocks.recentRepos = [
      { path: '/repos/one', type: 'local', name: 'one' },
      { path: '/repos/two', type: 'local', name: 'two', owner: 'intent-hq' },
    ];
    mocks.getRemoteUrl.mockImplementation((repoPath: string) =>
      repoPath === '/repos/one' ? (firstProbe as Promise<never>) : Promise.resolve({ success: false }),
    );
    mocks.pendingPrefill = {
      owner: 'acme',
      repo: 'one',
      number: 1,
      kind: 'issue',
      url: 'https://github.com/acme/one/issues/1',
    };

    const result = renderInitializer();
    // First prefill is now blocked probing /repos/one
    await waitFor(() => expect(mocks.getRemoteUrl).toHaveBeenCalledWith('/repos/one'));

    pushPrefill({
      owner: 'intent-hq',
      repo: 'two',
      number: 2,
      kind: 'issue',
      url: 'https://github.com/intent-hq/two/issues/2',
    });
    await waitFor(() => expect(textOf(result, 'picker-repo-path')).toBe('/repos/two'));

    // Release the stale first probe with a match for /repos/one
    releaseFirstProbe(remoteUrlResponse('acme', 'one'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The stale run must not override the newer selection or insert its mention
    expect(textOf(result, 'picker-repo-path')).toBe('/repos/two');
    expect(resolveGitHubPrefillSelection).toHaveBeenCalledTimes(1);
    expect(vi.mocked(resolveGitHubPrefillSelection).mock.calls[0][0]).toMatchObject({
      owner: 'intent-hq',
      repo: 'two',
      number: 2,
    });
  });

  it('keeps the current selection when probing errors (non-fatal)', async () => {
    mocks.pendingPrefill = {
      owner: 'intent-hq',
      repo: 'monorepo',
      number: 9,
      kind: 'issue',
      url: 'https://github.com/intent-hq/monorepo/issues/9',
    };
    mocks.recentRepos = [{ path: '/repos/other', type: 'local', name: 'other' }];
    mocks.getRemoteUrl.mockRejectedValue(new Error('ipc down'));

    const result = renderInitializer();
    // The prefill mention is still applied; repo selection is left unchanged.
    await waitFor(() => expect(textOf(result, 'picker-repo-path')).toBe(''));
    expect(textOf(result, 'picker-repo-type')).toBe('local');
  });
});
