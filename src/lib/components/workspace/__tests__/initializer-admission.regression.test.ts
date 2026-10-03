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
import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { workspaceInitializerGitSaga } from '$store/renderer/slices/workspace-initializer/sagas/workspace-initializer-git-saga';
let dispose: () => void;
let stopGit: () => void;
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
