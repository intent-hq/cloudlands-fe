import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wire-contract tests for the workspace.service ↔ daemon `workspace.*` write
 * path rewire (PROTOCOL.md §5.1). `updateWorkspace`, `deleteWorkspace`,
 * `archiveWorkspace`, and `unarchiveWorkspace` now delegate persistence to
 * the daemon; these tests pin the exact JSON-RPC method names and params
 * shapes so the wire contract cannot drift without the tests failing.
 */

const daemonWorkspaces = new Map<string, Record<string, unknown>>();

const requestMock = vi.hoisted(() =>
  vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === 'agent.list') return { agents: [] };
    if (method === 'note.list') return { notes: [] };
    if (method === 'workspace.list') {
      return { workspaces: Array.from(daemonWorkspaces.values()) };
    }
    if (method === 'workspace.get') {
      const id = String(params?.workspaceId ?? '');
      const match = daemonWorkspaces.get(id);
      if (!match) throw new Error('Workspace not found');
      return { workspace: match };
    }
    if (method === 'workspace.update') {
      const id = String(params?.workspaceId ?? '');
      const existing = daemonWorkspaces.get(id);
      if (!existing) throw new Error('Workspace not found');
      const { workspaceId: _wid, ...updates } = (params ?? {}) as Record<string, unknown>;
      const next = { ...existing, ...updates, updatedAt: '2024-06-01T00:00:00.000Z' };
      daemonWorkspaces.set(id, next);
      return { workspace: next };
    }
    if (method === 'workspace.delete') {
      const id = String(params?.workspaceId ?? '');
      daemonWorkspaces.delete(id);
      return { success: true };
    }
    if (method === 'workspace.archive') {
      const id = String(params?.workspaceId ?? '');
      const existing = daemonWorkspaces.get(id);
      if (!existing) throw new Error('Workspace not found');
      const next = {
        ...existing,
        status: 'Archived',
        archived: true,
        archivedAt: '2024-06-01T00:00:00.000Z',
        updatedAt: '2024-06-01T00:00:00.000Z',
      };
      daemonWorkspaces.set(id, next);
      return { success: true };
    }
    if (method === 'workspace.unarchive') {
      const id = String(params?.workspaceId ?? '');
      const existing = daemonWorkspaces.get(id);
      if (!existing) throw new Error('Workspace not found');
      const next = {
        ...existing,
        status: 'Active',
        archived: false,
        archivedAt: undefined,
        updatedAt: '2024-06-01T00:00:00.000Z',
      };
      daemonWorkspaces.set(id, next);
      return { success: true };
    }
    if (method === 'workspace.restore') {
      const id = String(params?.workspaceId ?? '');
      const existing = daemonWorkspaces.get(id);
      if (!existing) throw new Error('Workspace not found');
      const next = {
        ...existing,
        status: 'Active',
        archived: false,
        archivedAt: undefined,
        updatedAt: '2024-06-01T00:00:00.000Z',
      };
      daemonWorkspaces.set(id, next);
      return { workspace: next };
    }
    if (method === 'workspace.duplicate') {
      const id = String(params?.workspaceId ?? '');
      const existing = daemonWorkspaces.get(id);
      if (!existing) throw new Error('Workspace not found');
      const newId = `${id}-copy`;
      const newTitle =
        typeof params?.newTitle === 'string' && params.newTitle.trim().length > 0
          ? String(params.newTitle)
          : `${existing.title ?? 'Workspace'} (Copy)`;
      const next = {
        ...existing,
        id: newId,
        title: newTitle,
        branch: newId,
        createdAt: '2024-06-01T00:00:00.000Z',
        updatedAt: '2024-06-01T00:00:00.000Z',
        lastActivity: '2024-06-01T00:00:00.000Z',
      };
      daemonWorkspaces.set(newId, next);
      return { workspace: next };
    }
    if (method === 'workspace.cleanup') {
      return { success: true };
    }
    if (method === 'workspace.purge') {
      return { removed: 2, orphans: 1 };
    }
    if (method === 'workspace.findRepositories') {
      return { repositories: ['/repos/a', '/repos/b'] };
    }
    if (method === 'workspace.initializeRepository') {
      return { success: true };
    }
    return {};
  }),
);

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: requestMock }),
}));

vi.mock('../../../../store/main/redux-store-bridge', () => ({
  mainDispatch: vi.fn((action: unknown) => action),
}));

import { WorkspaceService } from '../workspace.service';
import { InMemoryWorkspaceRepository } from '../workspace.repository';
import { mainDispatch } from '../../../../store/main/redux-store-bridge';
import {
  PullRequestStatus,
  WorkspaceStatus,
  type Workspace,
  type WorkspaceId,
} from '../../../../shared/types';

function seed(overrides: Partial<Workspace> = {}): Workspace {
  const now = '2024-01-01T00:00:00.000Z';
  return {
    id: 'ws-target' as WorkspaceId,
    title: 'Target',
    branch: 'workspace-target',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('workspace.service ↔ daemon workspace.* write path (PROTOCOL.md §5.1)', () => {
  let service: WorkspaceService;
  let repository: InMemoryWorkspaceRepository;

  beforeEach(() => {
    requestMock.mockClear();
    daemonWorkspaces.clear();
    repository = new InMemoryWorkspaceRepository();
    service = new WorkspaceService(repository);
  });

  afterEach(() => {
    service.cleanup();
    vi.clearAllMocks();
  });

  it('updateWorkspace sends workspace.update with workspaceId + camelCase fields; no client updatedAt', async () => {
    const ws = seed();
    daemonWorkspaces.set(ws.id, { ...ws });

    const result = await service.updateWorkspace({ id: ws.id, title: 'Renamed' });

    expect(result.ok).toBe(true);
    const updateCalls = requestMock.mock.calls.filter(([m]) => m === 'workspace.update');
    expect(updateCalls).toHaveLength(1);
    const [, params] = updateCalls[0]!;
    expect(params).toEqual({ workspaceId: ws.id, title: 'Renamed' });
    // FE must not stamp `updatedAt` on the wire — daemon owns it.
    expect((params as Record<string, unknown>).updatedAt).toBeUndefined();
    if (result.ok) {
      expect(result.data.title).toBe('Renamed');
      expect(result.data.updatedAt).toBe('2024-06-01T00:00:00.000Z');
    }
  });

  it('updateWorkspace strips prStatus / activePullRequest / pullRequests before the wire call', async () => {
    const ws = seed();
    daemonWorkspaces.set(ws.id, { ...ws });

    const result = await service.updateWorkspace({
      id: ws.id,
      title: 'With PR',
      prStatus: 'open' as any,
      activePullRequest: { id: 'pr-1' } as any,
      pullRequests: [{ id: 'pr-1' } as any],
    });

    expect(result.ok).toBe(true);
    const updateCall = requestMock.mock.calls.find(([m]) => m === 'workspace.update');
    expect(updateCall).toBeDefined();
    const params = updateCall![1] as Record<string, unknown>;
    expect(params.prStatus).toBeUndefined();
    expect(params.activePullRequest).toBeUndefined();
    expect(params.pullRequests).toBeUndefined();
    // But callers still see them in the merged return.
    if (result.ok) {
      expect(result.data.prStatus).toBe(PullRequestStatus.Open);
      expect(result.data.activePullRequest).toEqual({ id: 'pr-1' });
      expect(result.data.pullRequests).toEqual([{ id: 'pr-1' }]);
    }
  });

  it('updateWorkspace normalizes prUrl empty string to null on the wire and coerces echoed nulls to undefined', async () => {
    const ws = seed({ prUrl: 'https://old' });
    daemonWorkspaces.set(ws.id, { ...ws });

    const result = await service.updateWorkspace({ id: ws.id, prUrl: '' });

    const updateCall = requestMock.mock.calls.find(([m]) => m === 'workspace.update');
    expect(updateCall).toBeDefined();
    expect((updateCall![1] as Record<string, unknown>).prUrl).toBeNull();
    // Merged workspace pins to the FE `Workspace` shape: cleared optionals must
    // be `undefined`, not `null`, so downstream consumers can rely on the type.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.prUrl).toBeUndefined();
    }
  });

  it('deleteWorkspace sends workspace.delete with { workspaceId }', async () => {
    const ws = seed();
    daemonWorkspaces.set(ws.id, { ...ws });

    const result = await service.deleteWorkspace(ws.id);

    expect(result.ok).toBe(true);
    const deleteCalls = requestMock.mock.calls.filter(([m]) => m === 'workspace.delete');
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]![1]).toEqual({ workspaceId: ws.id });
    expect(daemonWorkspaces.has(ws.id)).toBe(false);
  });

  it('archiveWorkspace sends workspace.archive and refetches workspace.get for canonical shape', async () => {
    const ws = seed();
    daemonWorkspaces.set(ws.id, { ...ws });

    const result = await service.archiveWorkspace(ws.id);

    expect(result.ok).toBe(true);
    const archiveCalls = requestMock.mock.calls.filter(([m]) => m === 'workspace.archive');
    expect(archiveCalls).toHaveLength(1);
    expect(archiveCalls[0]![1]).toEqual({ workspaceId: ws.id });
    // Refetch after archive.
    const getCallsAfter = requestMock.mock.calls.filter(([m]) => m === 'workspace.get');
    expect(getCallsAfter.length).toBeGreaterThanOrEqual(2);
    if (result.ok) {
      expect(result.data.archived).toBe(true);
      expect(result.data.status).toBe(WorkspaceStatus.Archived);
    }
  });

  it('unarchiveWorkspace sends workspace.unarchive and refetches workspace.get for canonical shape', async () => {
    const ws = seed({ status: WorkspaceStatus.Archived, archived: true });
    daemonWorkspaces.set(ws.id, { ...ws });

    const result = await service.unarchiveWorkspace(ws.id);

    expect(result.ok).toBe(true);
    const unarchiveCalls = requestMock.mock.calls.filter(([m]) => m === 'workspace.unarchive');
    expect(unarchiveCalls).toHaveLength(1);
    expect(unarchiveCalls[0]![1]).toEqual({ workspaceId: ws.id });
    if (result.ok) {
      expect(result.data.archived).toBe(false);
      expect(result.data.status).toBe(WorkspaceStatus.Active);
    }
  });

  it('getWorkspace never emits workspace.update (Wave A self-heal writeback collapse)', async () => {
    // The `getWorkspace` read path previously wrote worktree/git-info/diff
    // enrichment back to disk via `saveWorkspaceUpdates`, which advanced
    // daemon-stamped `updatedAt` and violated the "FE does not heal BE
    // payloads" contract. Post Wave A task 2, enrichment is in-memory only.
    const ws = seed();
    daemonWorkspaces.set(ws.id, { ...ws });

    const result = await service.getWorkspace(ws.id);

    expect(result.ok).toBe(true);
    const updateCalls = requestMock.mock.calls.filter(([m]) => m === 'workspace.update');
    expect(updateCalls).toHaveLength(0);
  });

  it('deleteWorkspace only emits workspace.delete on the wire (no self-heal writes)', async () => {
    // Regression pin: `deleteWorkspace` used to sweep local disk via
    // `repository.delete()`. Post Wave A task 2, only the daemon wire call
    // fires and no `workspace.update` writeback is emitted.
    const ws = seed();
    daemonWorkspaces.set(ws.id, { ...ws });

    const result = await service.deleteWorkspace(ws.id);

    expect(result.ok).toBe(true);
    const deleteCalls = requestMock.mock.calls.filter(([m]) => m === 'workspace.delete');
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]![1]).toEqual({ workspaceId: ws.id });
    const updateCalls = requestMock.mock.calls.filter(([m]) => m === 'workspace.update');
    expect(updateCalls).toHaveLength(0);
  });

  it('duplicateWorkspace sends workspace.duplicate with { workspaceId, newTitle? } and normalizes the returned workspace', async () => {
    const ws = seed();
    daemonWorkspaces.set(ws.id, { ...ws });

    const result = await service.duplicateWorkspace(ws.id, 'Renamed Copy');

    expect(result.ok).toBe(true);
    const duplicateCalls = requestMock.mock.calls.filter(([m]) => m === 'workspace.duplicate');
    expect(duplicateCalls).toHaveLength(1);
    expect(duplicateCalls[0]![1]).toEqual({ workspaceId: ws.id, newTitle: 'Renamed Copy' });
    if (result.ok) {
      expect(result.data.id).toBe(`${ws.id}-copy`);
      expect(result.data.title).toBe('Renamed Copy');
    }
  });

  it('duplicateWorkspace omits newTitle from the params when not provided', async () => {
    const ws = seed();
    daemonWorkspaces.set(ws.id, { ...ws });

    const result = await service.duplicateWorkspace(ws.id);

    expect(result.ok).toBe(true);
    const duplicateCalls = requestMock.mock.calls.filter(([m]) => m === 'workspace.duplicate');
    expect(duplicateCalls).toHaveLength(1);
    expect(duplicateCalls[0]![1]).toEqual({ workspaceId: ws.id });
  });

  it('restoreWorkspace sends workspace.restore with { workspaceId } and returns the daemon workspace', async () => {
    const ws = seed({ status: WorkspaceStatus.Archived, archived: true });
    daemonWorkspaces.set(ws.id, { ...ws });

    const result = await service.restoreWorkspace(ws.id);

    expect(result.ok).toBe(true);
    const restoreCalls = requestMock.mock.calls.filter(([m]) => m === 'workspace.restore');
    expect(restoreCalls).toHaveLength(1);
    expect(restoreCalls[0]![1]).toEqual({ workspaceId: ws.id });
    if (result.ok) {
      expect(result.data.archived).toBe(false);
      expect(result.data.status).toBe(WorkspaceStatus.Active);
    }
    // `restoreWorkspace` must not fall back to the retired unarchive path.
    const unarchiveCalls = requestMock.mock.calls.filter(([m]) => m === 'workspace.unarchive');
    expect(unarchiveCalls).toHaveLength(0);
    // The emitted `workspaceUpdated` delta must carry both `archived: false`
    // and the new `status`, otherwise the renderer's changes-merge leaves the
    // sidebar showing the stale `Archived` status until a full refetch.
    const updateDispatch = (mainDispatch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      ([action]) =>
        typeof action === 'object' && action !== null && 'type' in action &&
        (action as { type: string }).type === 'domainEvents/workspaceUpdated',
    );
    expect(updateDispatch).toBeDefined();
    const payload = (updateDispatch![0] as { payload: [{ workspaceId: string; changes: Record<string, unknown> }] })
      .payload[0];
    expect(payload.workspaceId).toBe(ws.id);
    expect(payload.changes).toEqual({
      archived: false,
      status: WorkspaceStatus.Active,
    });
  });

  it('cleanupWorkspace sends workspace.cleanup with { workspaceId } and no local shell-outs', async () => {
    const ws = seed();
    daemonWorkspaces.set(ws.id, { ...ws });

    const result = await service.cleanupWorkspace(ws.id);

    expect(result.ok).toBe(true);
    const cleanupCalls = requestMock.mock.calls.filter(([m]) => m === 'workspace.cleanup');
    expect(cleanupCalls).toHaveLength(1);
    expect(cleanupCalls[0]![1]).toEqual({ workspaceId: ws.id });
  });

  it('purgeDeletedWorkspaces sends workspace.purge with no params and returns { removed, orphans }', async () => {
    const result = await service.purgeDeletedWorkspaces();

    expect(result.ok).toBe(true);
    const purgeCalls = requestMock.mock.calls.filter(([m]) => m === 'workspace.purge');
    expect(purgeCalls).toHaveLength(1);
    // The daemon `workspace.purge` takes no params (PROTOCOL.md §5.1).
    expect(purgeCalls[0]![1]).toBeUndefined();
    if (result.ok) {
      expect(result.data).toEqual({ removed: 2, orphans: 1 });
    }
  });

  it('purgeDeletedWorkspaces clamps non-finite / non-number daemon counts to 0 (no NaN leaks)', async () => {
    requestMock.mockImplementationOnce(async (method: string) => {
      expect(method).toBe('workspace.purge');
      return { removed: 'oops', orphans: null };
    });
    const result = await service.purgeDeletedWorkspaces();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ removed: 0, orphans: 0 });
      expect(Number.isNaN(result.data.removed)).toBe(false);
      expect(Number.isNaN(result.data.orphans)).toBe(false);
    }
  });

  it('findRepositories sends workspace.findRepositories with { directory } and returns the daemon repositories list', async () => {
    const result = await service.findRepositories('/some/directory');

    expect(result.ok).toBe(true);
    const findCalls = requestMock.mock.calls.filter(([m]) => m === 'workspace.findRepositories');
    expect(findCalls).toHaveLength(1);
    expect(findCalls[0]![1]).toEqual({ directory: '/some/directory' });
    if (result.ok) {
      expect(result.data).toEqual(['/repos/a', '/repos/b']);
    }
  });

  it('findRepositories drops non-string entries instead of stringifying them', async () => {
    requestMock.mockImplementationOnce(async () => ({
      repositories: ['/repos/valid', { unexpected: true }, null, 42, '/repos/also-valid'],
    }));
    const result = await service.findRepositories('/some/directory');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(['/repos/valid', '/repos/also-valid']);
      // No `[object Object]` or other coerced garbage on the wire boundary.
      expect(result.data.every((r) => typeof r === 'string' && !r.includes('object'))).toBe(true);
    }
  });

  it('initializeNewRepository sends workspace.initializeRepository with { path } and no local git shell-outs', async () => {
    const result = await service.initializeNewRepository('/repos/new');

    expect(result.ok).toBe(true);
    const initCalls = requestMock.mock.calls.filter(([m]) => m === 'workspace.initializeRepository');
    expect(initCalls).toHaveLength(1);
    expect(initCalls[0]![1]).toEqual({ path: '/repos/new' });
  });
});
