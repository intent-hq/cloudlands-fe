import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceService } from '../main/workspace.service';
import { InMemoryWorkspaceRepository } from '../main/workspace.repository';
import type { Workspace, WorkspaceId, WorkspaceUIContext } from '../../../shared/types';
import { WorkspaceStatus } from '../../../shared/types';

vi.mock('../../../store/main/redux-store-bridge', () => ({
  mainDispatch: vi.fn((action: any) => action),
}));

// Stub the daemon client so WorkspaceService's activity-repair path
// (`note.list` / `agent.list` per PROTOCOL.md §5.4/§5.5) and the retired
// disk-read path's daemon replacement (`workspace.list` / `workspace.get` per
// §5.1) resolve to PROTOCOL-shaped results without reaching the real UDS
// socket. Workspace rows are seeded per-test through the `workspacesById` map
// (mirrored from `repository.save` in `beforeEach`).
const backendMocks = vi.hoisted(() => {
  const workspacesById = new Map<string, Record<string, unknown>>();
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (method === 'note.list') return { notes: [] };
    if (method === 'agent.list') return { agents: [] };
    if (method === 'workspace.list') {
      return { workspaces: Array.from(workspacesById.values()) };
    }
    if (method === 'workspace.get') {
      const id =
        params && typeof params === 'object' && 'workspaceId' in params
          ? String((params as { workspaceId?: unknown }).workspaceId ?? '')
          : '';
      const ws = workspacesById.get(id);
      if (!ws) throw new Error('Workspace not found');
      return { workspace: ws };
    }
    return {};
  });
  return { workspacesById, request };
});

vi.mock('../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: backendMocks.request }),
  onBackendReconnected: () => () => {},
}));

vi.mock('../../terminal/main/terminal.ipc', () => ({
  createTerminalFromBackend: vi.fn(),
}));

vi.mock('child_process', () => {
  const exec = vi.fn();
  const execFile = vi.fn();
  const spawn = vi.fn();
  return {
    default: { exec, execFile, spawn },
    exec,
    execFile,
    spawn,
    ChildProcess: class {},
  };
});

describe('WorkspaceService retention cleanup', () => {
  let service: WorkspaceService;
  let repository: InMemoryWorkspaceRepository;

  const createWorkspace = (id: WorkspaceId): Workspace => ({
    id,
    title: 'Retention Test Workspace',
    branch: 'workspace-retention-test',
    baseRef: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  });

  const createContext = (workspaceId: WorkspaceId): WorkspaceUIContext => ({
    workspaceId,
    mainContentType: 'empty',
    lastUpdated: '2024-01-01T00:00:00.000Z',
  });

  beforeEach(() => {
    repository = new InMemoryWorkspaceRepository();
    backendMocks.workspacesById.clear();
    backendMocks.request.mockClear();
    // Mirror every `repository.save` into the daemon-read stub so
    // `getWorkspace` / `listWorkspaces` (now backed by `workspace.get` /
    // `workspace.list`) see rows the test wrote through the write path.
    const originalSave = repository.save.bind(repository);
    repository.save = async (ws) => {
      await originalSave(ws);
      backendMocks.workspacesById.set(ws.id, { ...ws });
    };
    service = new WorkspaceService(repository);
  });

  afterEach(() => {
    service.cleanup();
    vi.clearAllMocks();
  });

  it('clears deleted workspace retention state and metadata-only caches on cleanup', async () => {
    const workspaceId = 'retention-test' as WorkspaceId;
    await repository.save(createWorkspace(workspaceId));
    await service.getWorkspace(workspaceId);
    await repository.save({ ...createWorkspace(workspaceId), title: 'Fresh Backing Title' });

    const rereadResult = await service.getWorkspace(workspaceId);
    expect(rereadResult.ok).toBe(true);
    if (rereadResult.ok) {
      expect(rereadResult.data.title).toBe('Fresh Backing Title');
    }

    (service as any).dirtyBackgroundEnrichment.add(workspaceId);
    (service as any).pendingBackgroundEnrichment.add(workspaceId);
    (service as any).backgroundEnrichmentQueue.push(workspaceId, workspaceId);

    service.onWorkspaceDeleted({ workspaceId });
    service.onWorkspaceDeleted({ workspaceId });

    expect((service as any).backgroundEnrichmentQueue).not.toContain(workspaceId);
    expect((service as any).dirtyBackgroundEnrichment.has(workspaceId)).toBe(false);
    expect((service as any).pendingBackgroundEnrichment.has(workspaceId)).toBe(false);
    expect((service as any).recentlyDeletedWorkspaces.has(workspaceId)).toBe(true);
    expect((service as any).recentlyDeletedCleanupTimers.size).toBe(1);

    service.cleanup();

    expect((service as any).dirtyBackgroundEnrichment.size).toBe(0);
    expect((service as any).pendingBackgroundEnrichment.size).toBe(0);
    expect((service as any).backgroundEnrichmentQueue).toHaveLength(0);
    expect((service as any).recentlyDeletedWorkspaces.size).toBe(0);
    expect((service as any).recentlyDeletedCleanupTimers.size).toBe(0);
  });

  it('evicts inactive metadata caches while retaining active metadata caches', async () => {
    const retainedWorkspaceId = 'retention-active' as WorkspaceId;
    const evictedWorkspaceId = 'retention-inactive' as WorkspaceId;
    await repository.save(createWorkspace(retainedWorkspaceId));
    await repository.save(createWorkspace(evictedWorkspaceId));
    await service.getWorkspace(retainedWorkspaceId);
    await service.getWorkspace(evictedWorkspaceId);

    (service as any).lastContextCache.set(retainedWorkspaceId, { path: '/active' });
    (service as any).lastContextCache.set(evictedWorkspaceId, { path: '/inactive' });
    (service as any).contextCacheOrder = [retainedWorkspaceId, evictedWorkspaceId];
    (service as any).dirtyBackgroundEnrichment.add(retainedWorkspaceId);
    (service as any).dirtyBackgroundEnrichment.add(evictedWorkspaceId);
    (service as any).pendingBackgroundEnrichment.add(retainedWorkspaceId);
    (service as any).pendingBackgroundEnrichment.add(evictedWorkspaceId);
    (service as any).backgroundEnrichmentQueue.push(retainedWorkspaceId);
    (service as any).backgroundEnrichmentQueue.push(evictedWorkspaceId);

    service.trimCachesToOpenWorkspaces([retainedWorkspaceId]);

    expect((service as any).lastContextCache.has(retainedWorkspaceId)).toBe(true);
    expect((service as any).lastContextCache.has(evictedWorkspaceId)).toBe(false);
    expect((service as any).dirtyBackgroundEnrichment.has(retainedWorkspaceId)).toBe(true);
    expect((service as any).dirtyBackgroundEnrichment.has(evictedWorkspaceId)).toBe(false);
    expect((service as any).pendingBackgroundEnrichment.has(retainedWorkspaceId)).toBe(true);
    expect((service as any).pendingBackgroundEnrichment.has(evictedWorkspaceId)).toBe(false);
    expect((service as any).backgroundEnrichmentQueue).toContain(retainedWorkspaceId);
    expect((service as any).backgroundEnrichmentQueue).not.toContain(evictedWorkspaceId);
  });

  it('bounds current context cache to 25 entries with LRU eviction', () => {
    for (let i = 0; i < 25; i++) {
      const workspaceId = `context-${i}` as WorkspaceId;
      (service as any).updateContextCache(workspaceId, createContext(workspaceId));
    }

    const refreshedWorkspaceId = 'context-0' as WorkspaceId;
    (service as any).updateContextCache(refreshedWorkspaceId, createContext(refreshedWorkspaceId));

    const newWorkspaceId = 'context-25' as WorkspaceId;
    (service as any).updateContextCache(newWorkspaceId, createContext(newWorkspaceId));

    expect((service as any).lastContextCache.size).toBe(25);
    expect((service as any).lastContextCache.has('context-0')).toBe(true);
    expect((service as any).lastContextCache.has('context-1')).toBe(false);
    expect((service as any).lastContextCache.has('context-25')).toBe(true);
    expect((service as any).contextCacheOrder).toHaveLength(25);
  });
});
