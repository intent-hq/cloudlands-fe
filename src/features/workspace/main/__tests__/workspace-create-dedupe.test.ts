import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceService } from '../workspace.service';
import { InMemoryWorkspaceRepository } from '../workspace.repository';
import { InMemoryNotesRepository } from '../../../notes/main/notes.repository';
import { mainDispatch } from '../../../../store/main/redux-store-bridge';
import { workspaceCreated } from '../../../../store/main/slices/workspace-lifecycle-events/workspace-lifecycle-events-slice';

vi.mock('../../../../store/main/redux-store-bridge', () => ({
  mainDispatch: vi.fn((action: unknown) => action),
}));

// The initial-agent save now routes through the daemon
// (PROTOCOL.md §5.5 `agent.create`); stub the JSON-RPC seam so the test does
// not open a real UDS socket.
vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: vi.fn(async () => ({ agent: { id: 'agent-first' } })) }),
}));

const mockedMainDispatch = vi.mocked(mainDispatch);

describe('WorkspaceService workspace creation dedupe', () => {
  let service: WorkspaceService;
  let repository: InMemoryWorkspaceRepository;

  beforeEach(() => {
    repository = new InMemoryWorkspaceRepository();
    vi.spyOn(repository, 'readGitConfig').mockResolvedValue(`
[core]
    repositoryformatversion = 0
[remote "origin"]
    url = https://github.com/test/repo.git
    fetch = +refs/heads/*:refs/remotes/origin/*
`);

    service = new WorkspaceService(repository, new InMemoryNotesRepository());
    mockedMainDispatch.mockClear();
  });

  afterEach(() => {
    service.cleanup();
    vi.clearAllMocks();
  });

  it('reuses an in-flight create for the same workspace target', async () => {
    const request = {
      repositoryPath: '/path/to/repo',
      skipWorktree: true,
      initialAgent: {
        agentId: 'agent-first',
        prompt: 'Review PR #123',
      },
    };

    const [first, second] = await Promise.all([
      service.createWorkspace(request),
      service.createWorkspace({
        ...request,
        initialAgent: {
          agentId: 'agent-second',
          prompt: 'Review PR #123',
        },
      }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.data.id).toBe(first.data.id);
    }

    const createdEvents = mockedMainDispatch.mock.calls.filter(
      ([action]) => action.type === workspaceCreated.type,
    );
    expect(createdEvents).toHaveLength(1);
  });
});