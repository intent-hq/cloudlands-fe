import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { WorkspaceService } from '../main/workspace.service';
import { InMemoryWorkspaceRepository } from '../main/workspace.repository';
import type { Workspace, WorkspaceId } from '../../../shared/types';
import { WorkspaceStatus } from '../../../shared/types';

vi.mock('../../../store/main/redux-store-bridge', () => ({
  mainDispatch: vi.fn((action: any) => action),
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

// Notes and agents now come from the daemon (PROTOCOL.md §5.4 `note.list`,
// §5.5 `agent.list`). Workspaces themselves now come from `workspace.list` /
// `workspace.get` (§5.1) after the disk-read path was retired; each test seeds
// `workspacesById` alongside the in-memory repository so the daemon stub
// mirrors the workspace records used by write-path helpers.
const backendMocks = vi.hoisted(() => {
  const notesByWorkspace = new Map<string, Array<{ createdAt?: string; updatedAt?: string }>>();
  const agentsByWorkspace = new Map<
    string,
    Array<{ lastActivity?: string; updatedAt?: string; createdAt?: string }>
  >();
  const workspacesById = new Map<string, Record<string, unknown>>();
  const rejectMethods = new Set<string>();
  const request = vi.fn(async (method: string, params: unknown) => {
    if (rejectMethods.has(method)) {
      throw new Error(`${method} unavailable`);
    }
    const workspaceId =
      params && typeof params === 'object' && 'workspaceId' in params
        ? String((params as { workspaceId?: unknown }).workspaceId ?? '')
        : '';
    if (method === 'note.list') {
      return { notes: notesByWorkspace.get(workspaceId) ?? [] };
    }
    if (method === 'agent.list') {
      return { agents: agentsByWorkspace.get(workspaceId) ?? [] };
    }
    if (method === 'workspace.list') {
      return { workspaces: Array.from(workspacesById.values()) };
    }
    if (method === 'workspace.get') {
      const ws = workspacesById.get(workspaceId);
      if (!ws) throw new Error('Workspace not found');
      return { workspace: ws };
    }
    if (method === 'workspace.update') {
      // Daemon-side: apply the update, stamp `updatedAt`, and return `{ workspace }`
      // per PROTOCOL.md §5.1 `workspace.update`.
      const existing = workspacesById.get(workspaceId);
      if (!existing) throw new Error('Workspace not found');
      const { workspaceId: _wid, ...updates } = (params ?? {}) as Record<string, unknown>;
      const next = {
        ...existing,
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      workspacesById.set(workspaceId, next);
      return { workspace: next };
    }
    return {};
  });
  return {
    notesByWorkspace,
    agentsByWorkspace,
    workspacesById,
    rejectMethods,
    request,
  };
});

vi.mock('../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: backendMocks.request }),
}));

describe('workspace activity timestamps', () => {
  let service: WorkspaceService;
  let repository: InMemoryWorkspaceRepository;

  const createWorkspace = (overrides: Partial<Workspace> = {}): Workspace => {
    const timestamp = '2023-06-01T10:00:00.000Z';
    return {
      id: 'old-space' as WorkspaceId,
      title: 'Old Workspace',
      branch: 'workspace-branch',
      baseRef: 'main',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      status: WorkspaceStatus.Active,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...overrides,
    };
  };

  beforeEach(() => {
    repository = new InMemoryWorkspaceRepository();
    // Mirror every `repository.save` into the daemon-read stub so
    // `listWorkspaces` / `getWorkspace` (now served by `workspace.list` /
    // `workspace.get`) observe the same rows the write path persisted.
    // Assigned directly (not via `vi.spyOn`) so per-test `vi.spyOn(repository,
    // 'save')` gets a fresh call-count baseline like it did before the daemon
    // read migration.
    const originalSave = repository.save.bind(repository);
    repository.save = async (ws) => {
      await originalSave(ws);
      backendMocks.workspacesById.set(ws.id, { ...ws });
    };
    service = new WorkspaceService(repository);
    backendMocks.notesByWorkspace.clear();
    backendMocks.agentsByWorkspace.clear();
    backendMocks.workspacesById.clear();
    backendMocks.rejectMethods.clear();
    backendMocks.request.mockClear();
  });

  afterEach(() => {
    service.cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('advances updatedAt for explicit workspace edits', async () => {
    const workspace = createWorkspace({ id: 'edit-space' as WorkspaceId });
    await repository.save(workspace);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-01T12:00:00.000Z'));
    const result = await service.updateWorkspace({ id: workspace.id, title: 'Updated Title' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.updatedAt).toBe('2024-02-01T12:00:00.000Z');
    }
  });

  // NOTE: The stale-PR-link enrichment tests were deleted alongside the FE
  // periodic PR refresh path and github.service (monorepo #699); PR data is
  // daemon-authoritative and the FE no longer fetches or clears PR links.

  // NOTE: FE-side compensation tests (repairWorkspaceActivityTimestamp,
  // deriveWorkspaceLastActivity, list/get fallback) were removed alongside the
  // helpers themselves. `lastActivity` is now daemon-authoritative on every
  // wire path (PROTOCOL.md §5.1 / §9.1); the FE renders whatever the daemon
  // returns without healing.
  it.skip('retired: FE no longer derives lastActivity', () => {});
});

