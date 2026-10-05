import { withHostPrincipal } from '../../../../test/fixtures/principal-state';
/**
 * @vitest-environment jsdom
 *
 * Component-level regression coverage for the tri-state git probe in
 * CompactWorkspaceInitializer (cloudlands-fe#1029): a `system:check-git`
 * transport failure (`available:'unknown'` or a rejected invoke) must render
 * the non-blocking "Unable to verify Git" warning — never the destructive
 * "Git is not installed" banner — and must NOT gate form validity, while a
 * daemon-confirmed `available:false` keeps blocking submission.
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
    checkGit: vi.fn(),
    request: vi.fn(),
  };
});

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));

vi.mock(
  '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors',
  async (original) => ({
    ...(await original<
      typeof import('$store/renderer/slices/workspace-initializer/workspace-initializer-selectors')
    >()),
    selectWorkspaceInitializerHydrated: () => mocks.readable(() => false),
    selectCompactWorkspaceInitializerFormState: () => mocks.readable(() => null),
    selectWorkspaceInitializerLastSelectedRepo: () => mocks.readable(() => null),
    selectWorkspaceInitializerLastSubmittedAgent: () => mocks.readable(() => null),
    selectWorkspaceInitializerRecentRepos: () => mocks.readable(() => []),
    selectWorkspaceInitializerPendingGitHubPrefill: () => mocks.readable(() => null),
    selectWorkspaceInitializerDefaultParentPath: () => mocks.readable(() => ''),
  }),
);

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

// Route the git probe to a per-test mock; everything else on the bridge is a
// benign success-with-null.
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.request }));

vi.mock('$lib/electron-bridge', () => ({
  isElectron: vi.fn(() => true),
  invoke: vi.fn(async (channel: string) => {
    if (channel === 'system:check-git') {
      const { mockInvoke } = await import('$shared/ipc-mock-router');
      return mockInvoke(channel);
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
import '$store/renderer/seeders/host-bridge-seeder';
import { store } from '$store/renderer/store';
import { workspaceInitializerGitSaga } from '$store/renderer/slices/workspace-initializer/sagas/workspace-initializer-git-saga';
import {
  principalContextChanged,
  principalReceived,
  principalIdentityChanged,
} from '$store/renderer/slices/principal/principal-slice';
import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { daemonEventsSubscribed } from '$store/renderer/slices/workspace-events/workspace-events-slice';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { selectWorkspaceInitializerGitAvailability } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
let dispose: () => void;
let stopGit: () => void;

function admit(
  role: 'owner' | 'member' | 'guest' = 'member',
  backendId = 'shared-host',
  principalId = 'member-A',
) {
  store.dispatch(principalContextChanged(null));
  store.dispatch(
    connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: backendId }),
  );
  store.dispatch(connectionStatusChanged('connected'));
  if (!store.state.workspaceEvents.subscriptionGeneration) store.dispatch(daemonEventsSubscribed());
  store.dispatch(setLabsMultiplayerEnabled(true));
  const { principal } = withHostPrincipal(store.state, role);
  principal.snapshot!.principal.id = principalId;
  store.dispatch(principalContextChanged(principal.context));
  store.dispatch(
    principalReceived(
      { context: principal.context!, invalidation: 0, presentationVersion: 0 },
      principal.snapshot!,
    ),
  );
}

import { m } from '$shared/paraglide/messages.js';
import { warmImport } from '../../../../test/warm-import';

const UNKNOWN_LABEL = m.workspace_compactInitializer_gitCheckUnknown_label();
const NOT_INSTALLED_LABEL = m.workspace_compactInitializer_gitNotInstalled_label();
const CREATE_LABEL = m.workspace_compactInitializer_createWorkspace_label();

function renderInitializer() {
  return render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
}

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

/** Satisfy every isValid clause except the git probe. */
async function selectValidLocalRepo() {
  await waitFor(() => expect(pickerCallbacks()).toBeTruthy());
  pickerCallbacks().onRepoChange({
    detail: { path: '/repos/monorepo', type: 'local', isValidPath: true },
  });
  pickerCallbacks().onBranchChange({ detail: { branch: 'main' } });
}

function createButton(result: ReturnType<typeof renderInitializer>) {
  const button = result.getAllByRole('button').find((el) => el.textContent?.includes(CREATE_LABEL));
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('./mocks/MockRichTextarea.svelte'));
warmImport(() => import('../initializer/__tests__/mocks/MockComponent.svelte'));
warmImport(() => import('./mocks/MockRepoAndBranchPicker.svelte'));

describe('CompactWorkspaceInitializer git-check unknown notice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    dispose = store.init();
    stopGit = store.runSaga(workspaceInitializerGitSaga);
    admit('owner');
    mocks.request.mockImplementation(async (method: string) => {
      const result = await mocks.checkGit();
      if (!result?.success || !result.data) throw new Error('backend unavailable');
      return method === 'host.toolAvailability' ? { tools: { git: result.data } } : result.data;
    });
    mocks.checkGit.mockResolvedValue({
      success: true,
      data: { available: true, version: '2.44.0' },
    });
  });

  afterEach(() => {
    cleanup();
    stopGit();
    dispose();
    sessionStorage.clear();
  });

  it("renders the non-blocking warning (not the install banner) when the probe returns available:'unknown'", async () => {
    mocks.checkGit.mockResolvedValue({ success: true, data: { available: 'unknown' } });

    const result = renderInitializer();
    await waitFor(() => expect(result.getByText(UNKNOWN_LABEL)).toBeTruthy());
    expect(result.queryByText(NOT_INSTALLED_LABEL)).toBeNull();
  });

  it("keeps the form submittable when the probe returns available:'unknown'", async () => {
    mocks.checkGit.mockResolvedValue({ success: true, data: { available: 'unknown' } });

    const result = renderInitializer();
    await waitFor(() => expect(result.getByText(UNKNOWN_LABEL)).toBeTruthy());
    await selectValidLocalRepo();

    await waitFor(() => expect(createButton(result).disabled).toBe(false));
  });

  it('treats a rejected invoke as unknown, not as missing git', async () => {
    mocks.checkGit.mockRejectedValue(new Error('ipc transport down'));

    const result = renderInitializer();
    await waitFor(() => expect(result.getByText(UNKNOWN_LABEL)).toBeTruthy());
    expect(result.queryByText(NOT_INSTALLED_LABEL)).toBeNull();

    await selectValidLocalRepo();
    await waitFor(() => expect(createButton(result).disabled).toBe(false));
  });

  it('still blocks submission with the install banner on a daemon-confirmed available:false', async () => {
    mocks.checkGit.mockResolvedValue({ success: true, data: { available: false } });

    const result = renderInitializer();
    await waitFor(() => expect(result.getByText(NOT_INSTALLED_LABEL)).toBeTruthy());
    expect(result.queryByText(UNKNOWN_LABEL)).toBeNull();

    await selectValidLocalRepo();
    // The git gate keeps isValid false no matter what else is selected.
    expect(createButton(result).disabled).toBe(true);
  });

  it('shows no git notice at all when the daemon confirms git is available', async () => {
    const result = renderInitializer();
    await selectValidLocalRepo();

    await waitFor(() => expect(createButton(result).disabled).toBe(false));
    expect(result.queryByText(UNKNOWN_LABEL)).toBeNull();
    expect(result.queryByText(NOT_INSTALLED_LABEL)).toBeNull();
  });

  it('routes an admitted member through the Git projection without owner-only diagnostics', async () => {
    admit('member');
    const result = renderInitializer();
    await waitFor(() =>
      expect(selectWorkspaceInitializerGitAvailability.select(store.state)).toBe(true),
    );
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith('host.toolAvailability', {
      tools: ['git'],
    });
    expect(result.queryByText(UNKNOWN_LABEL)).toBeNull();
    expect(result.queryByText(NOT_INSTALLED_LABEL)).toBeNull();
  });

  it.each([false, 'unknown'] as const)(
    'preserves the admitted member Git verdict %s',
    async (available) => {
      admit('member');
      mocks.checkGit.mockResolvedValue({ success: true, data: { available } });
      const result = renderInitializer();
      await waitFor(() =>
        expect(
          result.getByText(available === false ? NOT_INSTALLED_LABEL : UNKNOWN_LABEL),
        ).toBeTruthy(),
      );
      expect(mocks.request).toHaveBeenCalledExactlyOnceWith('host.toolAvailability', {
        tools: ['git'],
      });
      await selectValidLocalRepo();
      await waitFor(() => expect(createButton(result).disabled).toBe(available === false));
    },
  );

  it('retains a genuine member transport failure as a non-blocking warning', async () => {
    admit('member');
    mocks.checkGit.mockRejectedValue(new Error('shared host transport unavailable'));
    const result = renderInitializer();
    await waitFor(() => expect(result.getByText(UNKNOWN_LABEL)).toBeTruthy());
    expect(result.queryByText(NOT_INSTALLED_LABEL)).toBeNull();
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith('host.toolAvailability', {
      tools: ['git'],
    });
  });

  it('waits for authority and verifies after admission without remounting', async () => {
    store.dispatch(principalContextChanged(null));
    const result = renderInitializer();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(result.queryByText(UNKNOWN_LABEL)).toBeNull();
    admit('member');
    await waitFor(() =>
      expect(selectWorkspaceInitializerGitAvailability.select(store.state)).toBe(true),
    );
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith('host.toolAvailability', {
      tools: ['git'],
    });
    expect(result.queryByText(UNKNOWN_LABEL)).toBeNull();
  });

  it('does not probe or enable creation for a workspace-only guest', async () => {
    admit('guest');
    const result = renderInitializer();
    await selectValidLocalRepo();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(createButton(result).disabled).toBe(true);
    expect(result.queryByText(UNKNOWN_LABEL)).toBeNull();
  });

  it.each(['host', 'identity', 'reconnect'] as const)(
    'discards a held reply after %s changes and checks the newly admitted context',
    async (change) => {
      admit('member');
      let resolve!: (value: unknown) => void;
      mocks.checkGit.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      const result = renderInitializer();
      await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
      if (change === 'identity') store.dispatch(principalIdentityChanged('member-A'));
      else store.dispatch(backendReconnected());
      admit(
        'member',
        change === 'host' ? 'other-host' : 'shared-host',
        change === 'identity' ? 'member-B' : 'member-A',
      );
      await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(selectWorkspaceInitializerGitAvailability.select(store.state)).toBe(true),
      );
      resolve({ success: true, data: { available: false } });
      await new Promise((done) => setTimeout(done, 0));
      expect(selectWorkspaceInitializerGitAvailability.select(store.state)).toBe(true);
      expect(result.queryByText(NOT_INSTALLED_LABEL)).toBeNull();
      expect(result.queryByText(UNKNOWN_LABEL)).toBeNull();
    },
  );

  it('clears an old missing-Git notice while a newly selected host is pending', async () => {
    admit('member');
    mocks.checkGit.mockResolvedValueOnce({ success: true, data: { available: false } });
    const result = renderInitializer();
    await waitFor(() => expect(result.getByText(NOT_INSTALLED_LABEL)).toBeTruthy());
    let resolve!: (value: unknown) => void;
    mocks.checkGit.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    admit('member', 'healthy-host');
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.queryByText(NOT_INSTALLED_LABEL)).toBeNull());
    expect(result.queryByText(UNKNOWN_LABEL)).toBeNull();
    resolve({ success: true, data: { available: true } });
    await waitFor(() =>
      expect(selectWorkspaceInitializerGitAvailability.select(store.state)).toBe(true),
    );
  });

  it('does not accept a held owner result after demotion to workspace-only guest', async () => {
    let resolve!: (value: unknown) => void;
    mocks.checkGit.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const result = renderInitializer();
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
    admit('guest');
    resolve({ success: true, data: { available: true } });
    await selectValidLocalRepo();
    expect(createButton(result).disabled).toBe(true);
    expect(selectWorkspaceInitializerGitAvailability.select(store.state)).toBeNull();
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
});
