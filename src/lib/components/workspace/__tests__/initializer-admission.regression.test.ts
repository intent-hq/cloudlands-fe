/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    validate: vi.fn(),
    placement: vi.fn(),
    settled: vi.fn(),
    send: vi.fn(),
    gitCheck: vi.fn(),
    create: vi.fn(),
    captureCheckout: vi.fn(),
    update: vi.fn(),
    getBranches: vi.fn(),
    branchStatus: vi.fn(),
    toastError: vi.fn(),
    pull: vi.fn(async () => ({ success: true })),
    setReasoningEffort: vi.fn(),
    hydrated$: writable(false),
    compactFormState$: writable<{
      selectedSpecialist?: string | null;
      selectedModel?: string;
      modelWasOverridden?: boolean;
      selectedReasoningEffort?: string;
      isTeamMode?: boolean;
      skipIsolation?: boolean;
      repoPath?: string;
      repoType?: string;
      isValidPath?: boolean;
      isNewRepo?: boolean;
      branch?: string;
      repositoryCheckoutDraft?: import('$store/renderer/slices/repository-checkout/repository-checkout-types').RepositoryCheckoutDraft;
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

vi.mock(
  '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors',
  async (original) => ({
    ...(await original<
      typeof import('$store/renderer/slices/workspace-initializer/workspace-initializer-selectors')
    >()),
    selectWorkspaceInitializerHydrated: () => mocks.hydrated$,
    selectCompactWorkspaceInitializerFormState: () => mocks.compactFormState$,
    selectWorkspaceInitializerLastSelectedRepo: () => mocks.readable(() => null),
    selectWorkspaceInitializerLastSubmittedAgent: () => mocks.lastSubmittedAgent$,
    selectWorkspaceInitializerRecentRepos: () => mocks.readable(() => []),
    selectWorkspaceInitializerPendingGitHubPrefill: () => mocks.readable(() => null),
    selectWorkspaceInitializerBranchByRepo: () => mocks.readable(() => ({})),
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
    settled: mocks.settled,
    dispose: vi.fn(),
  })),
  resolveSetupScriptParam: vi.fn(() => undefined),
  REPO_CONFIG_SCRIPT_NAME: 'Repo config',
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceItems: () => mocks.readable(() => []),
}));

vi.mock('$lib/components/ui/toast', () => ({
  toast: { error: mocks.toastError, success: vi.fn(), warning: vi.fn(), message: vi.fn() },
}));

vi.mock('$lib/config/debug', () => ({
  debugConfig: { get: vi.fn((key: string) => key === 'enableFormPersistence') },
}));

vi.mock('$lib/client', () => ({
  appClient: {
    integrations: { captureRepositoryCheckout: mocks.captureCheckout },
    agents: { setReasoningEffort: mocks.setReasoningEffort },
    git: {
      pull: mocks.pull,
      getBranches: mocks.getBranches,
      branchStatus: mocks.branchStatus,
    },
    drafts: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    },
  },
}));

vi.mock('$lib/components/chat/input/attachment-placement', async (original) => ({
  ...(await original<typeof import('$lib/components/chat/input/attachment-placement')>()),
  placeAttachmentViaTransport: mocks.placement,
  mintPlacementIdempotencyKey: vi.fn(() => undefined),
}));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.send }));
vi.mock('$lib/client/live/live-prompt-enhancement', () => ({
  enhancePrompt: vi.fn(async (p: string) => ({ enhanced: p })),
  isEnhancePromptAvailable: vi.fn(() => true),
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
      return mocks.gitCheck();
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

vi.mock('$lib/components/workspace/initializer/RepoSelector.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockRepoSelector.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('$lib/utils/workspace-validation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/utils/workspace-validation')>()),
  validateRepoPath: mocks.validate,
}));
import CompactWorkspaceInitializer from '../CompactWorkspaceInitializer.svelte';
import { store } from '$store/renderer/store';
import { admitLegacyPrincipal, withHostPrincipal } from '../../../../test/fixtures/principal-state';
import {
  principalContextChanged,
  principalReceived,
} from '$store/renderer/slices/principal/principal-slice';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import {
  setLabsGitLabEnabled,
  setLabsMultiplayerEnabled,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { repositoryCheckoutSaga } from '$store/renderer/slices/repository-checkout/sagas/repository-checkout-saga';
import type {
  RepositoryCheckoutSession,
  CheckoutSelection,
} from '$shared/types/repository-checkout';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { gitlabAuthChanged } from '$store/renderer/slices/gitlab-auth/gitlab-auth-slice';
import { workspaceInitializerGitSaga } from '$store/renderer/slices/workspace-initializer/sagas/workspace-initializer-git-saga';
import { urlSubmitted } from '$store/renderer/slices/repository-checkout/repository-checkout-slice';
import { hydrateWorkspaceInitializer } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
let dispose: () => void;
let stopGit: () => void;
let stopCheckout: (() => void) | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mocks.gitCheck.mockResolvedValue({ success: true, data: { available: true } });
  dispose = store.init();
  stopGit = store.runSaga(workspaceInitializerGitSaga);
  admitLegacyPrincipal();
  store.dispatch(setLabsMultiplayerEnabled(false));
  mocks.hydrated$.set(true);
  mocks.compactFormState$.set({
    repoPath: '/owned/test/repo',
    repoType: 'local',
    isValidPath: true,
    isNewRepo: false,
    branch: 'main',
    skipIsolation: true,
  });
  mocks.create.mockResolvedValue({ ok: false, error: 'stop after request' });
  mocks.getBranches.mockResolvedValue({
    branches: ['main'],
    remoteBranches: [],
    defaultBranch: 'main',
    currentBranch: 'main',
  });
  mocks.branchStatus.mockResolvedValue({ ahead: 0, behind: 1, diverged: false });
  mocks.validate.mockResolvedValue({ valid: true });
  mocks.settled.mockResolvedValue(undefined);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  stopGit();
  stopCheckout?.();
  stopCheckout = undefined;
  dispose();
  sessionStorage.clear();
});
async function submit() {
  sessionStorage.setItem('workspace-prefill', JSON.stringify({ prompt: 'Build project' }));
  render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
  const b = document.querySelector<HTMLButtonElement>('[data-dialog-primary-action]')!;
  await waitFor(() => expect(b.disabled).toBe(false));
  await fireEvent.click(b);
  await waitFor(() => expect(mocks.validate).toHaveBeenCalledTimes(1));
}
describe('actual initializer submission admission', () => {
  it('keeps ordinary owner submission functional with Multiplayer off', async () => {
    await submit();
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
  });
  it('does not persist the old branch after held validation crosses readmission', async () => {
    let resolve!: (v: unknown) => void;
    mocks.validate.mockReturnValue(new Promise((r) => (resolve = r)));
    await submit();
    store.dispatch(backendReconnected());
    resolve({ valid: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(store.state.workspaceInitializer.branchByRepo['/owned/test/repo']).toBeUndefined();
    expect(mocks.pull).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

it.each([false, true])(
  'failed attachment retry retains its original admission (readmission=%s)',
  async (readmission) => {
    mocks.create.mockResolvedValue({
      ok: true,
      data: {
        workspace: { id: 'created', title: 'created', status: 'active' },
        initialAgent: { id: 'created-agent' },
      },
    });
    mocks.placement.mockRejectedValue(new Error('held placement failure'));
    mocks.send.mockResolvedValue({ success: true });
    sessionStorage.setItem('workspace-prefill', JSON.stringify({ prompt: 'Build project' }));
    const view = render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
    const file = new File(['owned test data'], 'notes.txt', { type: 'text/plain' });
    window.electronAPI.getPathForFile = vi.fn(() => '/owned/notes.txt');
    await fireEvent.drop(view.container.querySelector('[role="region"]')!, {
      dataTransfer: {
        files: [file],
        items: [
          {
            kind: 'file',
            type: 'text/plain',
            getAsFile: () => file,
            webkitGetAsEntry: () => ({ isDirectory: false }),
          },
        ],
        types: ['Files'],
      },
    });
    const button = view.container.querySelector<HTMLButtonElement>('[data-dialog-primary-action]')!;
    await waitFor(() => expect(button.disabled).toBe(false));
    await fireEvent.click(button);
    await waitFor(() => expect(mocks.placement).toHaveBeenCalledTimes(1));
    await screen.findByTestId('attachment-retry');
    if (readmission) {
      store.dispatch(backendReconnected());
      admitLegacyPrincipal();
    }
    mocks.placement.mockResolvedValue({
      attachmentId: 'placed',
      fileName: 'notes.txt',
      path: '/owned/placed',
    });
    await fireEvent.click(screen.getByTestId('attachment-retry'));
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.placement).toHaveBeenCalledTimes(readmission ? 1 : 2);
    expect(mocks.send).toHaveBeenCalledTimes(readmission ? 0 : 1);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  },
);

it('drops an original submission held by setup-probe settlement after readmission', async () => {
  let release!: () => void;
  mocks.settled.mockReturnValue(
    new Promise<void>((r) => {
      release = r;
    }),
  );
  await submit();
  await waitFor(() => expect(mocks.settled).toHaveBeenCalledOnce());
  store.dispatch(backendReconnected());
  admitLegacyPrincipal();
  release();
  await new Promise((r) => setTimeout(r, 20));
  expect(mocks.create).not.toHaveBeenCalled();
});
it('does not create after validation completes on an unmounted initializer', async () => {
  let release!: (v: unknown) => void;
  mocks.validate.mockReturnValue(
    new Promise((r) => {
      release = r;
    }),
  );
  await submit();
  cleanup();
  release({ valid: true });
  await new Promise((r) => setTimeout(r, 20));
  expect(mocks.create).not.toHaveBeenCalled();
  expect(store.state.workspaceInitializer.branchByRepo['/owned/test/repo']).toBeUndefined();
});

function admitHostMember() {
  store.dispatch(setLabsMultiplayerEnabled(true));
  const { principal } = withHostPrincipal(store.state, 'member');
  store.dispatch(principalContextChanged(principal.context));
  store.dispatch(
    principalReceived(
      {
        context: principal.context!,
        invalidation: 0,
        presentationVersion: store.state.principal.presentationVersion,
      },
      principal.snapshot!,
    ),
  );
}

it('verifies Git for an admitted shared-instance member without a phantom connection warning', async () => {
  admitHostMember();
  render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
  await waitFor(() => expect(mocks.gitCheck).toHaveBeenCalledOnce());
  expect(screen.queryByText('Unable to verify Git (connection issue)')).toBeNull();
});

describe('actual initializer qualified GitLab workspace creation', () => {
  const instanceBaseUrl = 'https://forge.example:8443/Forge';
  const projectPath = 'nested/team/target';
  const sha = 'c'.repeat(40);
  const contextUrl = `${instanceBaseUrl}/${projectPath}/-/merge_requests/17/diffs?view=parallel#note_42`;
  let session: RepositoryCheckoutSession;
  beforeEach(() => {
    mocks.compactFormState$.set(null);
    store.dispatch(setLabsGitLabEnabled(true));
    const listeners = new Set<() => void>();
    session = {
      capture: {
        checkoutId: 'original-lease',
        revision: 'original-account',
        provider: 'gitlab',
        instanceBaseUrl,
        expiresAfterMs: 600000,
      },
      onRetired: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      projects: vi.fn(async () => ({ status: 'ready', value: { items: [] } })),
      project: vi.fn(async (query) => ({
        status: 'ready',
        value: {
          project: {
            projectPath,
            name: 'target',
            namespace: 'nested/team',
            webUrl: `${instanceBaseUrl}/${projectPath}`,
            cloneUrl: `${instanceBaseUrl}/${projectPath}.git`,
            defaultBranch: 'trunk',
          },
          ...('url' in query ? { contextUrl: query.url } : {}),
        },
      })),
      branches: vi.fn(async (query) => ({
        status: 'ready',
        value: {
          items: [{ name: query.query || 'trunk', commitSha: sha }],
          cached: query.cached === true,
        },
      })),
      warm: vi.fn(async (selection) => ({
        status: 'ready',
        value: {
          projectPath: selection.projectPath,
          branch: selection.branch,
          commitSha: selection.commitSha,
          cached: true,
        },
      })),
      release: vi.fn(async () => {
        for (const listener of [...listeners]) listener();
        listeners.clear();
      }),
    };
    mocks.captureCheckout.mockResolvedValue({ status: 'ready', value: session });
    stopCheckout = store.runSaga(repositoryCheckoutSaga);
  });

  async function renderCheckout(
    mode: CheckoutSelection['mode'],
    extra: Record<string, unknown> = {},
  ) {
    sessionStorage.setItem(
      'workspace-prefill',
      JSON.stringify({
        prompt: 'Build the selected project',
        repoPath: '/stale/local',
        githubUrl: 'https://github.com/stale/repository',
        branch: 'github-pr-head',
        repositoryCheckoutDraft: {
          instanceBaseUrl,
          projectPath,
          mode,
          branch: 'release/next',
          checkoutId: 'stale-lease',
          revision: 'stale-account',
          commitSha: '0'.repeat(40),
        },
        ...extra,
      }),
    );
    return render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
  }

  it.each(['direct', 'cached'] as const)(
    'creates %s with only the freshly qualified branch and SHA',
    async (mode) => {
      await renderCheckout(mode);
      const button = document.querySelector<HTMLButtonElement>('[data-dialog-primary-action]')!;
      await waitFor(() => expect(button.disabled).toBe(false));
      await fireEvent.click(button);
      await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
      const request = mocks.create.mock.calls[0][0];
      expect(request.repositoryCheckout).toEqual({
        checkoutId: 'original-lease',
        revision: 'original-account',
        projectPath,
        branch: 'release/next',
        commitSha: sha,
        mode,
      });
      for (const key of [
        'repositoryPath',
        'githubUrl',
        'branch',
        'baseRef',
        'environmentConfig',
        'remote',
        'isNewRepo',
        'skipIsolation',
      ])
        expect(request).not.toHaveProperty(key);
      expect(request.progressId).toEqual(expect.any(String));
      expect(mocks.validate).not.toHaveBeenCalled();
      expect(mocks.getBranches).not.toHaveBeenCalled();
      expect(mocks.pull).not.toHaveBeenCalled();
      expect(mocks.settled).not.toHaveBeenCalled();
      expect(session.warm).toHaveBeenCalledTimes(mode === 'cached' ? 1 : 0);
    },
  );

  it('keeps an MR URL intact as context while creating from its target project default', async () => {
    await renderCheckout('direct', {
      repositoryCheckoutDraft: { instanceBaseUrl, contextUrl, mode: 'direct' },
    });
    const button = document.querySelector<HTMLButtonElement>('[data-dialog-primary-action]')!;
    await waitFor(() => expect(button.disabled).toBe(false));
    await fireEvent.click(button);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    const request = mocks.create.mock.calls[0][0];
    expect(session.project).toHaveBeenCalledWith({ url: contextUrl });
    expect(request.repositoryCheckout).toMatchObject({
      projectPath,
      branch: 'trunk',
      commitSha: sha,
    });
    expect(request.initialAgent.contextReferences).toContainEqual(
      expect.objectContaining({ provider: 'gitlab', url: contextUrl, content: contextUrl }),
    );
    expect(request.contextLinks).toContainEqual({
      kind: 'pr',
      url: contextUrl,
      owner: 'nested/team',
      repo: 'target',
      number: 17,
    });
    expect(request).not.toHaveProperty('branch');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each(['direct', 'cached'] as const)(
    'refreshes a failed %s checkout only on request and requires another explicit create',
    async (mode) => {
      mocks.create.mockResolvedValue({ ok: false, error: 'Forbidden', errorCode: 'forbidden' });
      await renderCheckout(mode);
      const button = document.querySelector<HTMLButtonElement>('[data-dialog-primary-action]')!;
      await waitFor(() => expect(button.disabled).toBe(false));
      await fireEvent.click(button);
      await screen.findByText('Forbidden');
      expect(screen.getByText(/Refresh to review the project, branch and commit/)).toBeTruthy();
      expect(mocks.create).toHaveBeenCalledOnce();
      expect(mocks.captureCheckout).toHaveBeenCalledOnce();
      expect(session.release).not.toHaveBeenCalled();
      await waitFor(() => expect(button.disabled).toBe(false));

      const nextSha = 'd'.repeat(40);
      const refreshed: RepositoryCheckoutSession = {
        ...session,
        capture: { ...session.capture, checkoutId: 'refreshed-lease', revision: 'refreshed' },
        onRetired: () => () => {},
        branches: vi.fn(async (query) => ({
          status: 'ready',
          value: {
            items: [{ name: query.query || 'trunk', commitSha: nextSha }],
            cached: query.cached === true,
          },
        })),
        release: vi.fn(async () => {}),
      };
      mocks.captureCheckout.mockResolvedValue({ status: 'ready', value: refreshed });
      await fireEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true }));
      await waitFor(() => expect(session.release).toHaveBeenCalled());
      await waitFor(() => expect(mocks.captureCheckout).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(getItems(store.state.repositoryCheckout.forms)[0]?.branch).toEqual({
          name: 'release/next',
          commitSha: nextSha,
        }),
      );
      await waitFor(() => expect(screen.queryByText('Forbidden')).toBeNull());
      expect(mocks.create).toHaveBeenCalledOnce();
      await waitFor(() =>
        expect(
          document.querySelector<HTMLButtonElement>('[data-dialog-primary-action]')?.disabled,
        ).toBe(false),
      );
      await fireEvent.click(document.querySelector('[data-dialog-primary-action]')!);
      await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
      expect(mocks.create.mock.calls[1][0].repositoryCheckout).toEqual({
        checkoutId: 'refreshed-lease',
        revision: 'refreshed',
        projectPath,
        branch: 'release/next',
        commitSha: nextSha,
        mode,
      });
      expect(mocks.validate).not.toHaveBeenCalled();
      expect(mocks.getBranches).not.toHaveBeenCalled();
    },
  );

  it.each(['direct', 'cached'] as const)(
    'restores a saved plain project URL and %s selection through a fresh checkout',
    async (mode) => {
      const projectUrl = `${instanceBaseUrl}/${projectPath}?ref=release%2Fnext#readme`;
      const view = await renderCheckout(mode);
      await waitFor(() =>
        expect(getItems(store.state.repositoryCheckout.forms)[0]?.branch?.name).toBe(
          'release/next',
        ),
      );
      const form = getItems(store.state.repositoryCheckout.forms)[0];
      store.dispatch(urlSubmitted(form.formId, form.scopeKey!, projectUrl));
      await waitFor(() => expect(session.project).toHaveBeenCalledWith({ url: projectUrl }));
      await waitFor(() =>
        expect(store.state.workspaceInitializer.compactFormState?.repositoryCheckoutDraft).toEqual({
          instanceBaseUrl,
          projectPath,
          branch: 'release/next',
          mode,
          contextUrl: projectUrl,
        }),
      );
      const saved = store.state.workspaceInitializer.compactFormState;
      expect(JSON.stringify(saved)).not.toMatch(/checkoutId|revision|commitSha/);
      view.unmount();
      await waitFor(() => expect(session.release).toHaveBeenCalled());
      session.capture = {
        ...session.capture,
        checkoutId: 'restored-lease',
        revision: 'new-account',
      };
      store.dispatch(hydrateWorkspaceInitializer({ compactFormState: saved }));
      mocks.compactFormState$.set(store.state.workspaceInitializer.compactFormState);
      sessionStorage.setItem(
        'workspace-prefill',
        JSON.stringify({ prompt: 'Reopen selected project' }),
      );
      render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
      await waitFor(() => expect(mocks.captureCheckout).toHaveBeenCalledTimes(2));
      const button = document.querySelector<HTMLButtonElement>('[data-dialog-primary-action]')!;
      await waitFor(() => expect(button.disabled).toBe(false));
      await fireEvent.click(button);
      await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
      expect(mocks.create.mock.calls[0][0].repositoryCheckout).toEqual({
        checkoutId: 'restored-lease',
        revision: 'new-account',
        projectPath,
        branch: 'release/next',
        commitSha: sha,
        mode,
      });
      expect(session.project).toHaveBeenLastCalledWith({ url: projectUrl });
      expect(mocks.validate).not.toHaveBeenCalled();
      expect(mocks.getBranches).not.toHaveBeenCalled();
    },
  );

  it('keeps cached creation disabled during warming and retires a late completion on account change', async () => {
    const held = Promise.withResolvers<Awaited<ReturnType<RepositoryCheckoutSession['warm']>>>();
    vi.mocked(session.warm).mockReturnValue(held.promise);
    await renderCheckout('cached');
    await waitFor(() => expect(session.warm).toHaveBeenCalledOnce());
    const button = document.querySelector<HTMLButtonElement>('[data-dialog-primary-action]')!;
    expect(button.disabled).toBe(true);
    store.dispatch(gitlabAuthChanged('revoked', 'forge.example:8443'));
    held.resolve({
      status: 'ready',
      value: { projectPath, branch: 'release/next', commitSha: sha, cached: true },
    });
    await waitFor(() => expect(session.release).toHaveBeenCalled());
    expect(button.disabled).toBe(true);
    expect(getItems(store.state.repositoryCheckout.forms)[0].project).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('refuses a malformed explicit checkout prefill without falling back to its local path', async () => {
    await renderCheckout('direct', {
      repositoryCheckoutDraft: {
        instanceBaseUrl: 'https://unknown.example/Forge',
        contextUrl,
        mode: 'direct',
      },
    });
    await waitFor(() =>
      expect(getItems(store.state.repositoryCheckout.forms)[0]?.unavailable?.reason).toBe(
        'invalid-target',
      ),
    );
    expect(mocks.captureCheckout).not.toHaveBeenCalled();
    const button = document.querySelector<HTMLButtonElement>('[data-dialog-primary-action]')!;
    expect(button.disabled).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.validate).not.toHaveBeenCalled();
  });
});
