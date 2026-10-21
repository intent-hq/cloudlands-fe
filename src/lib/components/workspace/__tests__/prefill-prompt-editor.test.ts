import { withLegacyPrincipal } from '../../../../test/fixtures/principal-state';
/**
 * @vitest-environment jsdom
 *
 * Regression test: a `workspace-prefill` prompt (an `intent://create` "Fix in
 * Intent" link, a home integration "Work on…") must appear in the prompt
 * editor. The New Space modal focuses the editor on open, and the focused
 * TipTap editor ignores external `value` changes, so applyPrefill() has to
 * push the prompt with setContent — the bound value alone left it invisible.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const admittedFixture = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
beforeEach(() => {
  admittedFixture.state = withLegacyPrincipal({
    hardwareConsole: { pttRecording: false, voiceTranscribing: false },
  });
});

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
  return createAppStoreMockModule({
    state: () => ({ ...admittedFixture.state }),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-selectors', () => ({
  selectWorkspaceInitializerAgentForRepo: { select: () => null },
  selectWorkspaceInitializerGitAvailability: () => ({
    subscribe(run: (value: boolean) => void) {
      run(true);
      return () => {};
    },
  }),
  selectWorkspaceInitializerHydrated: () => mocks.readable(() => true),
  selectCompactWorkspaceInitializerFormState: () => mocks.readable(() => mocks.formState),
  selectWorkspaceInitializerDefaultParentPath: () => mocks.readable(() => ''),
  selectWorkspaceInitializerLastSelectedRepo: () => mocks.readable(() => null),
  selectWorkspaceInitializerLastSubmittedAgent: () => mocks.readable(() => null),
  selectWorkspaceInitializerRecentRepos: () => mocks.readable(() => []),
  selectWorkspaceInitializerPendingGitHubPrefill: () => mocks.readable(() => null),
  selectWorkspaceInitializerDraftAuthority: () =>
    mocks.readable(() => ({ restore: undefined, clear: undefined })),
  selectWorkspaceInitializationOutcomeForConsumer: () => mocks.readable(() => undefined),
  selectWorkspaceInitializationResume: { select: () => undefined },
}));

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectAvailableModels: () => mocks.readable(() => []),
  selectSelectedModel: () => mocks.readable(() => undefined),
}));

vi.mock('$store/renderer/slices/provider-settings/provider-settings-selectors', () => ({
  selectActiveProviderId: () => mocks.readable(() => 'auggie'),
  selectEnabledProviders: () => mocks.readable(() => ({})),
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
  default: (await import('./mocks/MockFocusedRichTextarea.svelte')).default,
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

warmImport(() => import('./mocks/MockFocusedRichTextarea.svelte'));
warmImport(() => import('../initializer/__tests__/mocks/MockComponent.svelte'));

describe('prefilled prompt reaches the focused prompt editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.formState = githubFormState();
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it('shows the prompt from the prefill payload in the editor', async () => {
    sessionStorage.setItem(
      PREFILL_KEY,
      JSON.stringify({ repoPath: LOCAL_REPO, prompt: 'Fix the login bug' }),
    );

    const { component } = render(CompactWorkspaceInitializer, {
      props: { isExpanded: true },
    });
    await component.applyPrefill();

    await waitFor(() => {
      expect(screen.getByTestId('mock-rich-textarea').textContent).toBe('Fix the login bug');
    });
    expect(sessionStorage.getItem(PREFILL_KEY)).toBeNull();
  });

  it('never submits on its own for a prefill without autoCreate', async () => {
    sessionStorage.setItem(
      PREFILL_KEY,
      JSON.stringify({ repoPath: LOCAL_REPO, prompt: 'Fix the login bug' }),
    );

    const { component } = render(CompactWorkspaceInitializer, {
      props: { isExpanded: true },
    });
    await component.applyPrefill();

    await waitFor(() => {
      expect(screen.getByTestId('mock-rich-textarea').textContent).toBe('Fix the login bug');
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
