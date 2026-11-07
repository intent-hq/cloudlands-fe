import { withLegacyPrincipal } from '../../../../test/fixtures/principal-state';
/**
 * @vitest-environment jsdom
 *
 * + New workspace form (brief M1b/M4): a failed create renders the shared
 * creation error box — category title, the daemon's cause verbatim (never
 * rewritten into generic git text), guidance and Try again — and offers
 * Continue from last-fetched only for `base-refresh-failed`, which re-sends
 * the same create with `skipBaseRefresh: true` (PROTOCOL §9.2).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const admittedFixture = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
beforeEach(() => {
  admittedFixture.state = withLegacyPrincipal({});
});

const mocks = vi.hoisted(() => {
  const readable = <T>(getter: () => T) => ({
    subscribe(run: (value: T) => void) {
      run(getter());
      return () => {};
    },
  });
  function writable<T>(initial: T) {
    let value = initial;
    const subscribers = new Set<(value: T) => void>();
    return {
      subscribe(run: (value: T) => void) {
        subscribers.add(run);
        run(value);
        return () => subscribers.delete(run);
      },
      set(next: T) {
        value = next;
        for (const run of subscribers) run(next);
      },
      get() {
        return value;
      },
    };
  }
  const coordinator = {
    id: 'spec-writer',
    name: 'Coordinator',
    description: '',
    role: 'orchestrator',
  };
  const developer = { id: 'developer', name: 'Developer', description: '' };
  return {
    readable,
    dispatch: vi.fn(),
    goto: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    pull: vi.fn(async () => ({ success: true })),
    setReasoningEffort: vi.fn(),
    initializationOutcome$: writable<
      | Partial<
          import('$store/renderer/slices/workspace-initializer/workspace-initializer-types').WorkspaceInitializationOutcome
        >
      | undefined
    >(undefined),
    hydrated$: writable(false),
    compactFormState$: writable<{
      selectedSpecialist?: string | null;
      selectedModel?: string;
      modelWasOverridden?: boolean;
      selectedReasoningEffort?: string;
      isTeamMode?: boolean;
      skipIsolation?: boolean;
    } | null>(null),
    lastSubmittedAgent$: writable<{
      selectedSpecialist: string | null;
      selectedModel?: string;
      modelWasOverridden?: boolean;
      selectedReasoningEffort?: string;
      isTeamMode: boolean;
      selectedProvider?: string;
    } | null>(null),
    specialists$: writable([coordinator, developer]),
    customSpecialistsLoaded$: writable(true),
    fileSpecialistsLoaded$: writable(true),
    coordinator,
    developer,
  };
});

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ ...admittedFixture.state, workspaceCreateProgress: { byProgressId: {} } }),
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
  selectWorkspaceInitializerHydrated: () => mocks.hydrated$,
  selectCompactWorkspaceInitializerFormState: () => mocks.compactFormState$,
  selectWorkspaceInitializerLastSelectedRepo: () => mocks.readable(() => null),
  selectWorkspaceInitializerLastSubmittedAgent: () => mocks.lastSubmittedAgent$,
  selectWorkspaceInitializerRecentRepos: () => mocks.readable(() => []),
  selectWorkspaceInitializerPendingGitHubPrefill: () => mocks.readable(() => null),
  selectWorkspaceInitializerDefaultParentPath: () => mocks.readable(() => ''),
  selectWorkspaceInitializerDraftAuthority: () =>
    mocks.readable(() => ({ restore: undefined, clear: undefined })),
  selectWorkspaceInitializationOutcomeForConsumer: () => mocks.initializationOutcome$,
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

vi.mock('$store/renderer/slices/hardware-console/hardware-console-selectors', () => ({
  selectPttRecording: () => mocks.readable(() => false),
  selectVoiceTranscribing: () => mocks.readable(() => false),
}));

vi.mock('$store/renderer/slices/voice-settings/voice-settings-selectors', () => ({
  selectEffectiveVoiceEngine: () => mocks.readable(() => 'os'),
}));

vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: Object.assign(() => mocks.specialists$, {
    select: vi.fn(() => mocks.specialists$.get()),
  }),
  selectCustomSpecialistsLoaded: () => mocks.customSpecialistsLoaded$,
  selectFileSpecialistsLoaded: () => mocks.fileSpecialistsLoaded$,
  selectEffectiveBehaviorPrompt: { select: vi.fn(() => undefined) },
  selectEffectiveModel: { select: vi.fn(() => undefined) },
  selectEffectiveCodingAgent: { select: vi.fn(() => undefined) },
  selectUserOverrides: { select: vi.fn(() => ({ modelOverrides: {} })) },
  selectOrchestratorSpecialist: Object.assign(() => mocks.readable(() => mocks.coordinator), {
    select: vi.fn(() => mocks.coordinator),
  }),
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
  appClient: {
    agents: { setReasoningEffort: mocks.setReasoningEffort },
    git: { pull: mocks.pull },
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

vi.mock('$lib/utils/workspace-validation', async (importOriginal) => ({
  getGitErrorMessage: (await importOriginal<typeof import('$lib/utils/workspace-validation')>())
    .getGitErrorMessage,
  parseGitHubUrl: vi.fn(() => null),
  validateBranchName: vi.fn(() => ({ valid: true })),
  validateInitialPrompt: vi.fn(() => ({ valid: true })),
  validateRepoPath: vi.fn(async () => ({ valid: true })),
}));

vi.mock('$store/renderer/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { create: mocks.create, update: mocks.update },
}));

// The component gates git-dependent paths on `window.electronAPI` (provided by
// test-setup) and `invoke('system:check-git')`, which must report git present
// for the form to become valid.
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
  shell: { open: vi.fn(async () => {}) },
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
import { createWorkspaceInitializationDispatchAdapter } from './workspace-initialization-dispatch.test-helper';

const PREFILL_KEY = 'workspace-prefill';

function seedAutoCreatePrefill() {
  sessionStorage.setItem(
    PREFILL_KEY,
    JSON.stringify({
      repoPath: '/tmp/test-repo',
      branch: 'main',
      prompt: 'Build the thing',
      autoCreate: true,
    }),
  );
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('./mocks/MockRichTextarea.svelte'));
warmImport(() => import('../initializer/__tests__/mocks/MockComponent.svelte'));

const created = {
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
};

const alertBox = () => screen.getByRole('alert');
const buttonLabels = () =>
  Array.from(alertBox().querySelectorAll('button')).map((b) => (b.textContent ?? '').trim());

describe('CompactWorkspaceInitializer shared creation error box', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dispatch.mockImplementation(
      createWorkspaceInitializationDispatchAdapter({
        create: mocks.create,
        pull: mocks.pull,
        setOutcome: (outcome) => mocks.initializationOutcome$.set(outcome),
      }),
    );
    mocks.initializationOutcome$.set(undefined);
    sessionStorage.clear();
    mocks.hydrated$.set(false);
    mocks.compactFormState$.set(null);
    mocks.lastSubmittedAgent$.set(null);
    mocks.specialists$.set([mocks.coordinator, mocks.developer]);
    mocks.customSpecialistsLoaded$.set(true);
    mocks.fileSpecialistsLoaded$.set(true);
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it('shows the base-refresh title, cause, guidance, Try again and Continue; Continue re-sends with skipBaseRefresh', async () => {
    mocks.create
      .mockResolvedValueOnce({
        ok: false,
        error: "Couldn't update main from origin: Permission denied (publickey)",
        errorCode: 'base-refresh-failed',
        baseRefreshFailure: {
          category: 'auth-required',
          detail: 'git@github.com: Permission denied (publickey).',
          baseRef: 'main',
          remote: 'origin',
        },
      })
      .mockResolvedValueOnce(created);

    seedAutoCreatePrefill();
    const { component } = render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
    await component.applyPrefill();

    expect(await screen.findByText("Couldn't sign in to origin")).toBeTruthy();
    const text = alertBox().textContent ?? '';
    expect(text).toContain('git@github.com: Permission denied (publickey).');
    expect(text).toContain('no SSH key or agent that origin accepts');
    expect(text).not.toContain('Please check that you have access');
    expect(buttonLabels()).toEqual(
      expect.arrayContaining(['Try again', 'Continue from last-fetched main']),
    );
    const first = mocks.create.mock.calls[0][0] as Record<string, unknown>;
    expect(first).not.toHaveProperty('skipBaseRefresh');

    await fireEvent.click(screen.getByText('Continue from last-fetched main'));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    const second = mocks.create.mock.calls[1][0] as Record<string, unknown>;
    expect(second.skipBaseRefresh).toBe(true);
    const { progressId: _a, ...firstRest } = first;
    const { progressId: _b, skipBaseRefresh: _c, ...secondRest } = second;
    // Prompt, branch, setup script and model all survive into the Continue create.
    const withoutCreatedAt = (request: Record<string, unknown>) => {
      const initialAgent = request.initialAgent as { metadata?: Record<string, unknown> };
      const { createdAt: _d, ...metadata } = initialAgent.metadata ?? {};
      return { ...request, initialAgent: { ...initialAgent, metadata } };
    };
    expect(withoutCreatedAt(secondRest)).toEqual(withoutCreatedAt(firstRest));
    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-created'));
  });

  it('shows a generic daemon cause verbatim with Try again and no Continue', async () => {
    mocks.create
      .mockResolvedValueOnce({
        ok: false,
        error: 'Internal error: git fetch failed: git@github.com: Permission denied (publickey).',
      })
      .mockResolvedValueOnce(created);

    seedAutoCreatePrefill();
    const { component } = render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
    await component.applyPrefill();

    expect(
      await screen.findByText(
        'Internal error: git fetch failed: git@github.com: Permission denied (publickey).',
        { exact: false },
      ),
    ).toBeTruthy();
    expect(alertBox().textContent).not.toContain('Please check that you have access');
    expect(buttonLabels()).toContain('Try again');
    expect(buttonLabels().some((label) => label.includes('Continue'))).toBe(false);

    await fireEvent.click(screen.getByText('Try again'));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[1][0]).not.toHaveProperty('skipBaseRefresh');
  });

  it.each([
    ['branch', (picker: Picker) => picker.onBranchChange?.({ detail: { branch: 'develop' } })],
    [
      'repository',
      (picker: Picker) =>
        picker.onRepoChange?.({
          detail: { path: '/tmp/other-repo', type: 'local', isValid: true, branch: 'main' },
        }),
    ],
  ])(
    'stops offering Continue once the %s changes after a base-refresh failure',
    async (_, change) => {
      mocks.create.mockResolvedValueOnce({
        ok: false,
        error: "Couldn't update main from origin: Could not resolve host: github.com",
        errorCode: 'base-refresh-failed',
        baseRefreshFailure: {
          category: 'network',
          detail: 'Could not resolve host: github.com',
          baseRef: 'main',
          remote: 'origin',
        },
      });

      seedAutoCreatePrefill();
      const { component } = render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
      await component.applyPrefill();
      expect(await screen.findByText('Continue from last-fetched main')).toBeTruthy();

      change(
        (window as unknown as { __mockRepoAndBranchPicker: Picker }).__mockRepoAndBranchPicker,
      );

      await waitFor(() => expect(screen.queryByText('Continue from last-fetched main')).toBeNull());
      expect(mocks.create).toHaveBeenCalledTimes(1);
    },
  );
});

type Picker = {
  onRepoChange?: (event: { detail: Record<string, unknown> }) => void;
  onBranchChange?: (event: { detail: { branch: string } }) => void;
};
