/**
 * @vitest-environment jsdom
 *
 * Folder drop on the new-workspace modal (CompactWorkspaceInitializer):
 * dropped folders are detected synchronously at drop time and staged as
 * path-only folder pills on a local daemon; a remote daemon rejects the
 * WHOLE drop (files included) with one error toast; a folder with no
 * resolvable absolute host path is skipped with a toast. At submit, staged
 * folder items ride `initialAgent.contextReferences` as
 * `{ type: 'file', path, title }` (same shape as a folder @-mention).
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
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
    };
  }
  return {
    readable,
    dispatch: vi.fn(),
    goto: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    pull: vi.fn(async () => ({ success: true })),
    setReasoningEffort: vi.fn(),
    placeAttachment: vi.fn(),
    backendRequest: vi.fn(),
    hydrated$: writable(false),
    compactFormState$: writable<Record<string, unknown> | null>(null),
    isRemote: false,
  };
});

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ workspaceCreateProgress: { byProgressId: {} } }),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-selectors', () => ({
  selectWorkspaceInitializerHydrated: () => mocks.hydrated$,
  selectCompactWorkspaceInitializerFormState: () => mocks.compactFormState$,
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

vi.mock('$store/renderer/slices/hardware-console/hardware-console-selectors', () => ({
  selectPttRecording: () => mocks.readable(() => false),
  selectVoiceTranscribing: () => mocks.readable(() => false),
}));

vi.mock('$store/renderer/slices/voice-settings/voice-settings-selectors', () => ({
  selectEffectiveVoiceEngine: () => mocks.readable(() => 'os'),
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
  default: (await import('$features/onboarding/steps/__tests__/mocks/MockAttachmentPill.svelte'))
    .default,
}));

vi.mock('$lib/components/chat/input/attachment-placement', () => ({
  isRemoteBackend: () => mocks.isRemote,
  placeAttachmentViaTransport: (...args: unknown[]) => mocks.placeAttachment(...args),
  extractPlacementErrorDetail: (error: unknown) => String(error),
}));

// staged-attachments sends the held first message through `backendRequest`
// ('agent.sendMessage') — capture it so the pendingFirstMessage path can be
// asserted on the wire.
vi.mock('$lib/client/live/backend-transport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/client/live/backend-transport')>()),
  backendRequest: (...args: unknown[]) => mocks.backendRequest(...args),
}));

vi.mock('svelte-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

import CompactWorkspaceInitializer from '../CompactWorkspaceInitializer.svelte';
import { warmImport } from '../../../../test/warm-import';

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

/** Drop event whose DataTransferItem list carries folder-detection entries. */
function makeItemsDropEvent(entries: Array<{ file: File; isDirectory: boolean }>) {
  return {
    dataTransfer: {
      types: ['Files'],
      files: entries.map((e) => e.file),
      items: entries.map((e) => ({
        kind: 'file',
        getAsFile: () => e.file,
        webkitGetAsEntry: () => ({ isDirectory: e.isDirectory }),
      })),
    },
  };
}

function dropTarget(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>('[role="region"]')!;
}

function pills(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="attachment-pill"]'));
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('./mocks/MockRichTextarea.svelte'));
warmImport(() => import('../initializer/__tests__/mocks/MockComponent.svelte'));

describe('CompactWorkspaceInitializer folder drop (path references, local daemon only)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.hydrated$.set(false);
    mocks.compactFormState$.set(null);
    mocks.isRemote = false;
    mocks.setReasoningEffort.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it('local folder drop stages a folder pill carrying the absolute host path', async () => {
    (window as any).electronAPI.getPathForFile = vi.fn(() => '/home/user/projects/my-folder');
    const result = render(CompactWorkspaceInitializer, { props: { isExpanded: true } });

    const folder = new File(['x'], 'my-folder', { type: '' });
    await fireEvent.drop(
      dropTarget(result.container),
      makeItemsDropEvent([{ file: folder, isDirectory: true }]),
    );

    await waitFor(() => {
      expect(pills(result.container)).toHaveLength(1);
    });
    expect(pills(result.container)[0].dataset.name).toBe('my-folder');
    expect(pills(result.container)[0].dataset.type).toBe('folder');
    const { toast } = await import('svelte-sonner');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('remote drop containing a folder rejects the WHOLE drop with one error toast', async () => {
    mocks.isRemote = true;
    (window as any).electronAPI.getPathForFile = vi.fn(() => '/home/user/projects/my-folder');
    const result = render(CompactWorkspaceInitializer, { props: { isExpanded: true } });

    const folder = new File(['x'], 'my-folder', { type: '' });
    const file = new File(['y'], 'notes.txt', { type: 'text/plain' });
    await fireEvent.drop(
      dropTarget(result.container),
      makeItemsDropEvent([
        { file, isDirectory: false },
        { file: folder, isDirectory: true },
      ]),
    );

    const { toast } = await import('svelte-sonner');
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledTimes(1);
    });
    // Nothing attaches — not even the file in the same drop.
    expect(pills(result.container)).toHaveLength(0);
  });

  it('skips the folder with an error toast when no absolute path is resolvable', async () => {
    // Missing/empty getPathForFile bridge (e.g. dev:web): a bare folder
    // name must never be staged as if it were an absolute host path.
    (window as any).electronAPI.getPathForFile = vi.fn(() => '');
    const result = render(CompactWorkspaceInitializer, { props: { isExpanded: true } });

    const folder = new File(['x'], 'my-folder', { type: '' });
    await fireEvent.drop(
      dropTarget(result.container),
      makeItemsDropEvent([{ file: folder, isDirectory: true }]),
    );

    const { toast } = await import('svelte-sonner');
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledTimes(1);
    });
    expect(pills(result.container)).toHaveLength(0);
  });

  it('submit maps a staged folder into initialAgent.contextReferences', async () => {
    (window as any).electronAPI.getPathForFile = vi.fn(() => '/home/user/projects/my-folder');
    mocks.create.mockResolvedValue({ ok: false, error: 'stop after payload capture' });

    const result = render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
    const folder = new File(['x'], 'my-folder', { type: '' });
    await fireEvent.drop(
      dropTarget(result.container),
      makeItemsDropEvent([{ file: folder, isDirectory: true }]),
    );
    await waitFor(() => {
      expect(pills(result.container)).toHaveLength(1);
    });

    seedAutoCreatePrefill();
    await (result.component as { applyPrefill: () => Promise<void> }).applyPrefill();
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));

    const initialAgent = mocks.create.mock.calls[0][0].initialAgent;
    expect(initialAgent.contextReferences).toEqual(
      expect.arrayContaining([
        { type: 'file', path: '/home/user/projects/my-folder', title: 'my-folder' },
      ]),
    );
  });

  it('re-dropping the same folder is a no-op (one pill, one reference)', async () => {
    (window as any).electronAPI.getPathForFile = vi.fn(() => '/home/user/projects/my-folder');
    mocks.create.mockResolvedValue({ ok: false, error: 'stop after payload capture' });

    const result = render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
    const folder = new File(['x'], 'my-folder', { type: '' });
    const dropEvent = () => makeItemsDropEvent([{ file: folder, isDirectory: true }]);
    await fireEvent.drop(dropTarget(result.container), dropEvent());
    await fireEvent.drop(dropTarget(result.container), dropEvent());

    // One pill — a duplicate path-derived id would break keyed rendering
    // and make one remove drop both pills.
    await waitFor(() => {
      expect(pills(result.container)).toHaveLength(1);
    });

    seedAutoCreatePrefill();
    await (result.component as { applyPrefill: () => Promise<void> }).applyPrefill();
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));

    const refs = mocks.create.mock.calls[0][0].initialAgent.contextReferences as Array<{
      path?: string;
    }>;
    expect(refs.filter((r) => r.path === '/home/user/projects/my-folder')).toHaveLength(1);
  });

  it('mixed folder + staged file: references survive into the held first message sent after placement', async () => {
    (window as any).electronAPI.getPathForFile = vi.fn(
      (f: File) => `/home/user/projects/${f.name}`,
    );
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
    mocks.placeAttachment.mockResolvedValue({
      ok: true,
      path: '.intent/attachments/notes.txt',
      fileName: 'notes.txt',
      size: 1,
      attachmentId: 'att-1',
      mimeType: 'text/plain',
    });
    mocks.backendRequest.mockResolvedValue({ success: true });

    const result = render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
    const folder = new File(['x'], 'my-folder', { type: '' });
    const file = new File(['y'], 'notes.txt', { type: 'text/plain' });
    await fireEvent.drop(
      dropTarget(result.container),
      makeItemsDropEvent([
        { file, isDirectory: false },
        { file: folder, isDirectory: true },
      ]),
    );
    await waitFor(() => {
      expect(pills(result.container)).toHaveLength(2);
    });

    seedAutoCreatePrefill();
    await (result.component as { applyPrefill: () => Promise<void> }).applyPrefill();
    await waitFor(() => expect(mocks.backendRequest).toHaveBeenCalledTimes(1));

    // The staged file holds back the first message from workspace.create...
    const initialAgent = mocks.create.mock.calls[0][0].initialAgent;
    expect(initialAgent.prompt).toBeUndefined();
    expect(initialAgent.contextReferences).toBeUndefined();
    // ...the file is placed into the created workspace from its sourcePath...
    expect(mocks.placeAttachment).toHaveBeenCalledWith(
      'ws-created',
      'notes.txt',
      expect.objectContaining({ sourcePath: '/home/user/projects/notes.txt' }),
    );
    // ...and the folder reference rides the held agent.sendMessage alongside
    // the attachment-reference file block.
    const [method, params] = mocks.backendRequest.mock.calls[0] as [
      string,
      {
        agentId: string;
        workspaceId: string;
        content: string;
        contextReferences?: unknown[];
        fileBlocks?: unknown[];
      },
    ];
    expect(method).toBe('agent.sendMessage');
    expect(params.agentId).toBe('agent-created');
    expect(params.workspaceId).toBe('ws-created');
    expect(params.content).toBe('Build the thing');
    expect(params.contextReferences).toEqual(
      expect.arrayContaining([
        { type: 'file', path: '/home/user/projects/my-folder', title: 'my-folder' },
      ]),
    );
    expect(params.fileBlocks).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'file', attachmentId: 'att-1' })]),
    );
  });
});
