import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { BrowserWindow } from 'electron';
import { WorkspaceService } from '../main/workspace.service';
import { InMemoryWorkspaceRepository } from '../main/workspace.repository';
import { InMemoryNotesRepository } from '../../notes/main/notes.repository';
import type { PullRequestInfo, Workspace } from '../../../shared/types';
import { PullRequestStatus, WorkspaceStatus } from '../../../shared/types';
import type { WorkspaceId } from '../../../shared/types/branded-ids';

const githubServiceMocks = vi.hoisted(() => ({
  getPullRequest: vi.fn(),
  getCheckRuns: vi.fn(),
  getReviews: vi.fn(),
}));

vi.mock('../../../store/main/redux-store-bridge', () => ({
  mainDispatch: vi.fn((action: any) => action),
}));

vi.mock('../../terminal/main/terminal.ipc', () => ({
  createTerminalFromBackend: vi.fn(),
}));

vi.mock('../../agent/main/agent-persistence', () => ({
  agentPersistence: {
    listAgents: vi.fn().mockResolvedValue([]),
    loadAgent: vi.fn(),
  },
}));

vi.mock('../../git-tracking/main/github.service', () => ({
  GitHubService: class {},
  githubService: {
    getPullRequest: githubServiceMocks.getPullRequest,
    getCheckRuns: githubServiceMocks.getCheckRuns,
    getReviews: githubServiceMocks.getReviews,
  },
}));

describe('WorkspaceService PR refresh enrichment', () => {
  let service: WorkspaceService;
  let repository: InMemoryWorkspaceRepository;
  let send: ReturnType<typeof vi.fn>;

  const createOpenPullRequest = (): PullRequestInfo => ({
    id: '1',
    number: 1,
    url: 'https://github.com/test/repo/pull/1',
    title: 'Test PR',
    status: PullRequestStatus.Open,
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
  });

  beforeEach(() => {
    repository = new InMemoryWorkspaceRepository();
    service = new WorkspaceService(repository, new InMemoryNotesRepository());
    send = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      {
        isDestroyed: () => false,
        webContents: { send },
      } as any,
    ]);
    githubServiceMocks.getPullRequest.mockReset();
    githubServiceMocks.getCheckRuns.mockReset();
    githubServiceMocks.getReviews.mockReset();
  });

  afterEach(() => {
    service.cleanup();
    vi.clearAllMocks();
  });

  it('broadcasts prStatus and pullRequests when periodic refresh sees an open PR become merged', async () => {
    const pullRequest = createOpenPullRequest();
    const workspace: Workspace = {
      id: '11111111-1111-4111-8111-111111111111' as WorkspaceId,
      title: 'PR Refresh Workspace',
      branch: 'feature/test-pr',
      baseRef: 'main',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      status: WorkspaceStatus.Active,
      createdAt: '2026-05-01T10:00:00.000Z',
      updatedAt: '2026-05-01T10:00:00.000Z',
      repositoryOwner: 'test',
      repositoryName: 'repo',
      prNumber: pullRequest.number,
      prUrl: pullRequest.url,
      prStatus: PullRequestStatus.Open,
      activePullRequest: pullRequest,
      pullRequests: [pullRequest],
    };
    await repository.save(workspace);
    githubServiceMocks.getPullRequest.mockResolvedValue({
      sourceBranch: workspace.branch,
      headSha: 'merged-head-sha',
      mergeable: true,
      mergeableState: 'clean',
      state: 'merged',
    });
    githubServiceMocks.getCheckRuns.mockResolvedValue({ total: 1, passed: 1, failed: 0, pending: 0 });
    githubServiceMocks.getReviews.mockResolvedValue({
      reviewDecision: null,
      approvalCount: 0,
      changesRequestedCount: 0,
      approvedBy: [],
    });

    await (service as any).performPRRefreshEnrichment(workspace.id);

    expect(send).toHaveBeenCalledWith('workspace:background-enrichment-complete', {
      workspaceId: workspace.id,
      updates: expect.objectContaining({
        prStatus: PullRequestStatus.Merged,
        activePullRequest: expect.objectContaining({
          number: pullRequest.number,
          status: PullRequestStatus.Merged,
        }),
        pullRequests: [
          expect.objectContaining({
            number: pullRequest.number,
            status: PullRequestStatus.Merged,
          }),
        ],
      }),
    });
  });
});