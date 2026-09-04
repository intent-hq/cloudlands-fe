/**
 * @vitest-environment jsdom
 *
 * Regression test (intent-hq/monorepo#2148): after a successful create,
 * `clearForm()` must preserve the repo selection (repoPath/repoType/
 * githubUrl/branch/isNewRepo/isValidPath/scope) in the persisted form state
 * so the next new-workspace form re-opens on the same repo, while still
 * clearing per-create state (remoteSetup). Agent prefs stay preserved, and
 * the last-used setup script is restored for the preserved repo.
 */
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompactWorkspaceInitializerFormState } from '$store/renderer/slices/workspace-initializer/workspace-initializer-types';

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
    create: vi.fn(),
    update: vi.fn(),
    getLastUsedSetupScript: vi.fn(() => undefined),
    recordLastUsedSetupScript: vi.fn(),
    // Per-test persisted form state returned by the selector mock (read
    // synchronously at component init as `savedState`).
    savedFormState: null as unknown,
  };
});

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: mocks.dispatch });
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

vi.mock('$features/setup-scripts/last-used', () => ({
  getLastUsedSetupScript: mocks.getLastUsedSetupScript,
  recordLastUsedSetupScript: mocks.recordLastUsedSetupScript,
}));

vi.mock('$lib/config/debug', () => ({
  debugConfig: { get: vi.fn(() => false) },
}));

vi.mock('$lib/client', () => ({
  appClient: {
    git: { pull: vi.fn(async () => ({ success: true })) },
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

vi.mock('$lib/utils/workspace-validation', () => ({
  getGitErrorMessage: (message: string) => message,
  parseGitHubUrl: vi.fn(() => null),
  validateBranchName: vi.fn(() => ({ valid: true })),
  validateInitialPrompt: vi.fn(() => ({ valid: true })),
  validateRepoPath: vi.fn(async () => ({ valid: true })),
}));

vi.mock('$store/renderer/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { create: mocks.create, update: mocks.update },
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
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('$lib/components/chat/AttachmentPreview.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

import CompactWorkspaceInitializer from '../CompactWorkspaceInitializer.svelte';
import { warmImport } from '../../../../test/warm-import';

const PREFILL_KEY = 'workspace-prefill';
const SET_COMPACT_FORM_STATE = 'workspaceInitializer/setCompactFormState';

function mockCreateSuccess() {
  mocks.create.mockResolvedValue({
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
      initialAgent: { id: 'agent-created' },
    },
  });
}

/** The form state persisted by clearForm() — the last setCompactFormState dispatch. */
function lastPersistedFormState(): CompactWorkspaceInitializerFormState {
  const persisted = mocks.dispatch.mock.calls
    .map(([action]) => action)
    .filter((action) => action.type === SET_COMPACT_FORM_STATE);
  expect(persisted.length).toBeGreaterThan(0);
  return persisted[persisted.length - 1].payload[0];
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('./mocks/MockRichTextarea.svelte'));
warmImport(() => import('../initializer/__tests__/mocks/MockComponent.svelte'));

describe('post-create repo-field preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.savedFormState = null;
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it('preserves the local repo selection and agent prefs in the persisted form state', async () => {
    mockCreateSuccess();
    sessionStorage.setItem(
      PREFILL_KEY,
      JSON.stringify({
        repoPath: '/tmp/test-repo',
        branch: 'main',
        prompt: 'Build the thing',
        autoCreate: true,
      }),
    );

    const { component } = render(CompactWorkspaceInitializer, {
      props: { isExpanded: false },
    });
    await component.applyPrefill();
    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-created'));

    const formState = lastPersistedFormState();
    expect(formState).toMatchObject({
      repoPath: '/tmp/test-repo',
      repoType: 'local',
      githubUrl: '',
      branch: 'main',
      isNewRepo: false,
      isValidPath: true,
      scope: '',
    });
    // Agent prefs — always preserved
    expect(formState.selectedSpecialist).toBe('spec-writer');
    expect(formState.isTeamMode).toBe(true);
    // No scope selected → no scopeRepoPath
    expect(formState.scopeRepoPath).toBeUndefined();
  });

  it('round-trips a preserved GitHub selection (repoType github + githubUrl)', async () => {
    mockCreateSuccess();
    mocks.savedFormState = {
      repoPath: '/tmp/clones/acme-app',
      repoType: 'github',
      githubUrl: 'https://github.com/acme/app',
      branch: 'main',
      isNewRepo: false,
      isValidPath: true,
      scope: 'packages/app',
      scopeRepoPath: '/tmp/clones/acme-app',
    } satisfies CompactWorkspaceInitializerFormState;
    // Prefill with prompt only — no repoPath, so the restored GitHub
    // selection is not overridden.
    sessionStorage.setItem(
      PREFILL_KEY,
      JSON.stringify({ prompt: 'Build the thing', autoCreate: true }),
    );

    const { component } = render(CompactWorkspaceInitializer, {
      props: { isExpanded: false },
    });
    await component.applyPrefill();
    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-created'));

    expect(lastPersistedFormState()).toMatchObject({
      repoPath: '/tmp/clones/acme-app',
      repoType: 'github',
      githubUrl: 'https://github.com/acme/app',
      branch: 'main',
      isValidPath: true,
      scope: 'packages/app',
      scopeRepoPath: '/tmp/clones/acme-app',
    });

    // Setup-script restoration keys GitHub repos by path + source URL
    expect(mocks.getLastUsedSetupScript).toHaveBeenCalledWith(
      '/tmp/clones/acme-app',
      'https://github.com/acme/app',
    );
  });

  it('clears remoteSetup in the persisted form state (stale remote state must not leak)', async () => {
    mockCreateSuccess();
    sessionStorage.setItem(
      PREFILL_KEY,
      JSON.stringify({
        repoPath: '/tmp/test-repo',
        branch: 'main',
        prompt: 'Build the thing',
        autoCreate: true,
        environmentType: 'remote',
        sshConfig: { host: 'remote-host', port: 22, username: 'dev' },
      }),
    );

    const { component } = render(CompactWorkspaceInitializer, {
      props: { isExpanded: false },
    });
    await component.applyPrefill();
    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-created'));

    const formState = lastPersistedFormState();
    expect(formState.remoteSetup).toBeNull();
    // Repo selection is still preserved alongside the cleared remote state
    expect(formState.repoPath).toBe('/tmp/test-repo');
  });

  it('resets a remote selection to defaults (unusable without its cleared remoteSetup)', async () => {
    mockCreateSuccess();
    // A restored remote selection: submission depends on remoteSetup
    // (workspacePath/environmentConfig), which clearForm always nulls, so
    // preserving repoType 'remote' would leave a valid-looking broken form.
    mocks.savedFormState = {
      repoPath: '/remote/workspace/app',
      repoType: 'remote',
      githubUrl: '',
      branch: 'main',
      isNewRepo: false,
      isValidPath: true,
      scope: '',
      remoteSetup: {
        type: 'remote',
        host: 'remote-host',
        port: 22,
        username: 'dev',
        workspacePath: '/remote/workspace/app',
      },
    } satisfies CompactWorkspaceInitializerFormState;
    sessionStorage.setItem(
      PREFILL_KEY,
      JSON.stringify({ prompt: 'Build the thing', autoCreate: true }),
    );

    const { component } = render(CompactWorkspaceInitializer, {
      props: { isExpanded: false },
    });
    await component.applyPrefill();
    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-created'));

    expect(lastPersistedFormState()).toMatchObject({
      repoPath: '',
      repoType: 'local',
      githubUrl: '',
      branch: '',
      isNewRepo: false,
      isValidPath: false,
      scope: '',
      remoteSetup: null,
    });
  });

  it('restores the last used setup script for the preserved local repo', async () => {
    mockCreateSuccess();
    sessionStorage.setItem(
      PREFILL_KEY,
      JSON.stringify({
        repoPath: '/tmp/test-repo',
        branch: 'main',
        prompt: 'Build the thing',
        autoCreate: true,
      }),
    );

    const { component } = render(CompactWorkspaceInitializer, {
      props: { isExpanded: false },
    });
    await component.applyPrefill();
    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-created'));

    // Local repos key last-used by path only (no source URL)
    expect(mocks.getLastUsedSetupScript).toHaveBeenCalledWith('/tmp/test-repo', undefined);
  });
});
