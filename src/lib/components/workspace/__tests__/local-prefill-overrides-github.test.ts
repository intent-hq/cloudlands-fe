/**
 * @vitest-environment jsdom
 *
 * Regression test: a `workspace-prefill` entry with `repoPath` (a local-source
 * "Work on…" click) must set the FULL repo selection — repoType 'local' with
 * githubUrl cleared — and must win over form state restored from
 * persistence, so the modal opens on the Copy local repo tab instead of the
 * github tab left behind by a persisted last selection.
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
    create: vi.fn(),
    update: vi.fn(),
    // Persisted (restored) compact form state — a github selection
    formState: null as Record<string, unknown> | null,
  };
});

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: mocks.dispatch });
});

vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-selectors', () => ({
  selectWorkspaceInitializerHydrated: () => mocks.readable(() => true),
  selectCompactWorkspaceInitializerFormState: () => mocks.readable(() => mocks.formState),
  selectWorkspaceInitializerLastSelectedRepo: () => mocks.readable(() => null),
  selectWorkspaceInitializerLastSubmittedAgent: () => mocks.readable(() => null),
  selectWorkspaceInitializerRecentRepos: () => mocks.readable(() => []),
  selectWorkspaceInitializerPendingGitHubPrefill: () => mocks.readable(() => null),
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
  selectCustomSpecialistsLoaded: () => mocks.readable(() => true),
  selectFileSpecialistsLoaded: () => mocks.readable(() => true),
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

vi.mock('$lib/config/debug', () => ({
  debugConfig: { get: vi.fn(() => false) },
}));

vi.mock('$lib/client', () => ({
  appClient: { git: { pull: vi.fn(async () => ({ success: true })) } },
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
import { setCompactWorkspaceInitializerFormState } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
import { warmImport } from '../../../../test/warm-import';

const PREFILL_KEY = 'workspace-prefill';
const LOCAL_REPO = '/tmp/local-repo';

function githubFormState() {
  return {
    repoPath: 'intent-hq/monorepo',
    repoType: 'github',
    githubUrl: 'https://github.com/intent-hq/monorepo',
    branch: 'main',
    isNewRepo: false,
    isValidPath: true,
    // A persisted remote selection: submission reads remoteSetup.workspacePath
    // regardless of repoType, so a local prefill must clear it.
    remoteSetup: { type: 'remote', ssh: { host: 'remote.example' }, workspacePath: '/remote/ws' },
  };
}

/** Latest form state persisted through Redux by the component's save $effect. */
function lastPersistedFormState(): Record<string, unknown> | undefined {
  const calls = mocks.dispatch.mock.calls.filter(
    ([action]) => action?.type === setCompactWorkspaceInitializerFormState.type,
  );
  return calls.at(-1)?.[0]?.payload?.[0];
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('./mocks/MockRichTextarea.svelte'));
warmImport(() => import('../initializer/__tests__/mocks/MockComponent.svelte'));

describe('local repoPath prefill overrides a restored github selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.formState = githubFormState();
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it('sets the full local selection when prefill is present at mount (onMount reader)', async () => {
    sessionStorage.setItem(PREFILL_KEY, JSON.stringify({ repoPath: LOCAL_REPO }));

    const { component } = render(CompactWorkspaceInitializer, {
      props: { isExpanded: false },
    });
    await component.applyPrefill();

    await waitFor(() => {
      const persisted = lastPersistedFormState();
      expect(persisted).toBeDefined();
      expect(persisted).toMatchObject({
        repoPath: LOCAL_REPO,
        repoType: 'local',
        githubUrl: '',
        isNewRepo: false,
        isValidPath: true,
        scope: '',
        // Stale remote/branch state from the persisted selection is cleared
        // so submission can't target the previous remote checkout or a branch
        // that doesn't exist in the local repo.
        remoteSetup: null,
        branch: '',
      });
    });
  });

  it('applyPrefill() overrides a repoPath restored from persistence (relaxed guard)', async () => {
    // No prefill at mount: the form restores the persisted github selection,
    // leaving repoPath non-empty ('owner/repo' shorthand).
    const { component } = render(CompactWorkspaceInitializer, {
      props: { isExpanded: false },
    });

    // Then an explicit local-entry click stores the prefill and the modal
    // calls applyPrefill() — it must not be dropped by the old !repoPath guard.
    sessionStorage.setItem(PREFILL_KEY, JSON.stringify({ repoPath: LOCAL_REPO }));
    await component.applyPrefill();

    await waitFor(() => {
      const persisted = lastPersistedFormState();
      expect(persisted).toBeDefined();
      expect(persisted).toMatchObject({
        repoPath: LOCAL_REPO,
        repoType: 'local',
        githubUrl: '',
        isNewRepo: false,
        isValidPath: true,
        scope: '',
        remoteSetup: null,
        branch: '',
      });
    });
    // The prefill key is consumed so it is not reapplied on the next mount
    expect(sessionStorage.getItem(PREFILL_KEY)).toBeNull();
  });

  it('honors an explicit branch from the prefill payload after the reset', async () => {
    sessionStorage.setItem(
      PREFILL_KEY,
      JSON.stringify({ repoPath: LOCAL_REPO, branch: 'feature-x' }),
    );

    const { component } = render(CompactWorkspaceInitializer, {
      props: { isExpanded: false },
    });
    await component.applyPrefill();

    await waitFor(() => {
      const persisted = lastPersistedFormState();
      expect(persisted).toBeDefined();
      expect(persisted).toMatchObject({
        repoPath: LOCAL_REPO,
        repoType: 'local',
        remoteSetup: null,
        // The persisted 'main' is dropped, but the prefill's own branch wins.
        branch: 'feature-x',
      });
    });
  });
});
