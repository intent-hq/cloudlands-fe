import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearLayout: vi.fn(),
  clearState: vi.fn(),
  redeem: vi.fn(),
  send: vi.fn(),
}));

vi.mock('$lib/client/live/backend-transport', () => ({
  electronAPI: () => window.electronAPI,
  observeBackendNodeCapabilities: vi.fn(async () => ({ server: { capabilities: null } })),
  backendRequest: vi.fn(() => new Promise(() => {})),
  backendSubscribe: vi.fn(() => new Promise(() => {})),
  backendUnsubscribe: vi.fn(async () => {}),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/electron-bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/electron-bridge')>()),
  invoke: vi.fn(() => new Promise(() => {})),
}));
vi.mock('$lib/components/workspace/initializer/staged-attachments', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  redeemStagedAttachments: mocks.redeem,
  sendHeldFirstMessage: mocks.send,
}));
vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: () => ({ clearLayout: mocks.clearLayout }),
}));
vi.mock('./slices/workspace/utils/workspace-storage-manager', () => ({
  workspaceStorageManager: { clearState: mocks.clearState },
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  },
}));

import { WorkspaceId } from '$shared/types/branded-ids';
import { createMockWorkspace } from '../../test/factories/workspace.factory';
import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';
import { startAppStoreLifecycle } from './app-store-lifecycle';
import { startRootStoreLifecycle } from './root-store-lifecycle';
import { store as appStore } from './store';
import { selectPrincipalActionContext } from './slices/principal/principal-selectors';
import { workspaceClient } from './slices/workspace/utils/workspace.client';
import { selectWorkspaceInitializationOutcomeForConsumer } from './slices/workspace-initializer/workspace-initializer-selectors';
import { workspaceInitializationRequested } from './slices/workspace-initializer/workspace-initializer-slice';
import type { WorkspaceInitializationRequest } from './slices/workspace-initializer/workspace-initializer-types';

const consumer = { id: 'composition-consumer', resourceId: 'composition-resource' };
const workspace = createMockWorkspace({
  id: WorkspaceId('composition-workspace'),
  worktreePath: '/worktrees/composition-workspace',
});
const created = { ok: true, data: { workspace, initialAgent: { id: 'agent-1' } } } as const;
let stopRoot: (() => void) | undefined;
let stopApp: (() => void) | undefined;

function startProductionLifecycle() {
  stopRoot = startRootStoreLifecycle(appStore, { startSagas: () => [] });
  stopApp = startAppStoreLifecycle(appStore);
  admitLegacyPrincipal();
}

function stopProductionLifecycle() {
  stopApp?.();
  stopRoot?.();
  stopApp = stopRoot = undefined;
}

function request(): WorkspaceInitializationRequest {
  return {
    entrypoint: 'compact',
    admission: selectPrincipalActionContext.select(appStore.state) as string,
    createRequest: {
      title: 'Composition workspace',
      repositoryPath: '/repo',
      branch: 'main',
    },
    agentTitle: 'Agent',
    coordinator: false,
    stagedItems: [],
    heldMessage: { content: 'hello', imageBlocks: [], contextReferences: [] },
    lastSubmittedAgent: { selectedModel: 'sonnet' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redeem.mockResolvedValue({ items: [], fileBlocks: [], failedCount: 0 });
  mocks.send.mockResolvedValue({ sent: true });
  vi.spyOn(window.electronAPI!, 'invoke').mockImplementation(() => new Promise(() => {}));
  startProductionLifecycle();
});

afterEach(() => {
  stopProductionLifecycle();
  vi.restoreAllMocks();
});

describe('workspace initializer production composition', () => {
  it('cancels a deferred create across teardown and ignores its late settlement after reinit', async () => {
    const held = Promise.withResolvers<typeof created>();
    const create = vi
      .spyOn(workspaceClient, 'create')
      .mockReturnValueOnce(held.promise)
      .mockResolvedValue(created);
    const first = workspaceInitializationRequested(request(), consumer);
    appStore.dispatch(first);
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());

    stopProductionLifecycle();
    await expect(first.promise).rejects.toThrow('initialization-cancelled');
    startProductionLifecycle();
    const reentered = workspaceInitializationRequested(request(), consumer);
    appStore.dispatch(reentered);
    await expect(reentered.promise).resolves.toEqual({
      workspaceId: 'composition-workspace',
      agentId: 'agent-1',
      workspacePath: '/worktrees/composition-workspace',
    });

    held.resolve(created);
    await Promise.resolve();
    expect(create).toHaveBeenCalledTimes(2);
    expect(mocks.clearLayout).toHaveBeenCalledOnce();
    expect(mocks.clearState).toHaveBeenCalledOnce();
    expect(mocks.redeem).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(
      selectWorkspaceInitializationOutcomeForConsumer.select(appStore.state, consumer.id),
    ).toMatchObject({ seq: reentered.seq, status: 'success' });
  });
});
