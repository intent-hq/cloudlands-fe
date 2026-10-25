import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Retired workspaces (PROTOCOL §5.1 "Retired workspaces") are returned by
 * `workspace.list` only with the explicit `includeRetired: true` opt-in. The
 * main-process list callers ask for `includeArchived: true` only, so they
 * must never send the opt-in and must drop any `Retired` row defensively.
 */

const daemonWorkspaces: Array<Record<string, unknown>> = [];

const requestMock = vi.hoisted(() => vi.fn());

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: requestMock }),
  onBackendReconnected: () => () => {},
}));

import { WorkspaceService } from '../workspace.service';
import { InMemoryWorkspaceRepository } from '../workspace.repository';

const row = (id: string, status: string) => ({
  id,
  title: id,
  branch: id,
  status,
  archived: status !== 'Active',
  ...(status === 'Retired' ? { retiredAt: '2026-10-20T00:00:00.000Z' } : {}),
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

describe('workspace.service never lists retired workspaces (strict includeRetired opt-in)', () => {
  let service: WorkspaceService;

  beforeEach(() => {
    daemonWorkspaces.length = 0;
    daemonWorkspaces.push(row('active-ws', 'Active'), row('archived-ws', 'Archived'));
    // A daemon that (wrongly) leaked a retired row must still not reach callers.
    daemonWorkspaces.push(row('retired-ws', 'Retired'));
    requestMock.mockImplementation(async (method: string) => {
      if (method === 'workspace.list') return { workspaces: daemonWorkspaces };
      return {};
    });
    service = new WorkspaceService(new InMemoryWorkspaceRepository());
  });

  afterEach(() => {
    service.cleanup();
    vi.clearAllMocks();
  });

  it('includeArchived: true requests no retired rows and filters any it receives', async () => {
    const listed = await service.listWorkspaces({ includeArchived: true });

    expect(requestMock).toHaveBeenCalledWith('workspace.list', { includeArchived: true });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.data.workspaces.map((w) => w.id)).toEqual(['active-ws', 'archived-ws']);
    expect(listed.data.total).toBe(2);
  });

  it('protocol-adapter list calls (includeArchived by default) never see retired rows', async () => {
    // test-setup mocks the adapter module globally; exercise the real one.
    const { ProtocolAdapter } = await vi.importActual<
      typeof import('../../../protocol/main/protocol-adapter')
    >('../../../protocol/main/protocol-adapter');
    const adapter = new ProtocolAdapter(service, {} as never);

    const lite = await adapter.listWorkspaces();
    const all = await adapter.listAllWorkspaces();

    for (const result of [lite, all]) {
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.data.map((w: { id: string }) => w.id)).not.toContain('retired-ws');
    }
    for (const [method, params] of requestMock.mock.calls) {
      if (method === 'workspace.list') expect(params).not.toHaveProperty('includeRetired');
    }
  });
});
