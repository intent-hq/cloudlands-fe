/**
 * Tests for AcceptChangesService.exportFiles
 *
 * Tests the exportFiles function which:
 * - Filters out gitignored files using git check-ignore
 * - Uses execFileAsync for safe git add (command injection protection)
 * - Handles both auto-detected files and user-provided file lists
 * - Escapes backslashes and single quotes when passing to printf
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorkspaceId } from '$shared/types/branded-ids';
import type { Workspace } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';

// Mock dependencies before importing the service
const mockExecAsync = vi.fn();
const mockExecFileAsync = vi.fn();
vi.mock('../../../shared/git/git-env', () => ({
  execAsync: (...args: any[]) => mockExecAsync(...args),
  execFileAsync: (...args: any[]) => mockExecFileAsync(...args),
}));

const mockFsMkdir = vi.fn();
const mockFsCopyFile = vi.fn();
vi.mock('fs/promises', () => ({
  default: {
    mkdir: (...args: any[]) => mockFsMkdir(...args),
    copyFile: (...args: any[]) => mockFsCopyFile(...args),
  },
}));

const mockFindById = vi.fn();
vi.mock('../../workspace/main/workspace.repository', () => ({
  FileSystemWorkspaceRepository: class {
    findById = (...args: any[]) => mockFindById(...args);
  },
}));

// Mock gitService
const mockGitServiceGetStatus = vi.fn().mockResolvedValue({ ok: true, data: { files: [] } });
const mockGitServiceCommit = vi.fn();
const mockGitServiceClearStatusCache = vi.fn();
vi.mock('../../git/main/git.service', () => ({
  gitService: {
    getStatus: (...args: any[]) => mockGitServiceGetStatus(...args),
    commit: (...args: any[]) => mockGitServiceCommit(...args),
    clearStatusCache: (...args: any[]) => mockGitServiceClearStatusCache(...args),
  },
}));

// Mock githubService
const mockCreatePullRequest = vi.fn();
const mockGetPullRequests = vi.fn();
const mockGetPullRequest = vi.fn();
vi.mock('../../git-tracking/main/github.service', () => ({
  GitHubService: class {},
  githubService: {
    createPullRequest: (...args: any[]) => mockCreatePullRequest(...args),
    getPullRequests: (...args: any[]) => mockGetPullRequests(...args),
    getPullRequest: (...args: any[]) => mockGetPullRequest(...args),
  },
}));

// Mock backgroundGitOpsService
const mockRegisterOperation = vi.fn().mockReturnValue('test-operation-id');
const mockCompleteOperation = vi.fn();
const mockFailOperation = vi.fn();
const mockUpdateProgress = vi.fn();
vi.mock('../../git/main/background-git-ops.service', () => ({
  backgroundGitOpsService: {
    registerOperation: (...args: any[]) => mockRegisterOperation(...args),
    completeOperation: (...args: any[]) => mockCompleteOperation(...args),
    failOperation: (...args: any[]) => mockFailOperation(...args),
    updateProgress: (...args: any[]) => mockUpdateProgress(...args),
  },
}));

vi.mock('../../git/main/git-router', () => ({
  getWorkspaceGitInfo: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../shared/main/ssh-manager', () => ({
  sshManager: {},
}));

vi.mock('../../../shared/main/remote-rpc-manager', () => ({
  remoteRPCManager: { getClient: vi.fn() },
}));

vi.mock('../../../shared/main/remote-rpc-client', () => ({
  RemoteRPCError: class extends Error {
    code: number;
    data: any;
    constructor(message: string, code: number, data?: any) {
      super(message);
      this.code = code;
      this.data = data;
    }
  },
}));

vi.mock('../../../shared/git/keychain-suppression', () => ({
  isKeychainAccessSuppressed: vi.fn().mockReturnValue(false),
  suppressKeychainAccess: vi.fn(),
  clearKeychainSuppression: vi.fn(),
}));

vi.mock('../../events/main/unified-event-bus', () => ({
  unifiedEventBus: { emitDomainEvent: vi.fn(), emit: vi.fn() },
}));

vi.mock('../../../shared/logger', () => ({
  Logger: class {
    info() {}
    debug() {}
    warn() {}
    error() {}
  },
}));

vi.mock('../../../shared/git/git-error-handler', () => ({
  isGitAuthError: () => false,
  getGitAuthErrorMessage: () => '',
  isKeychainAccessCancelled: () => false,
}));

vi.mock('../../workspace/main/change-detector-manager', () => ({
  changeDetectorManager: {},
}));

vi.mock('../../workspace/main/provenance/attribution-engine', () => ({
  getAttributionEngine: vi.fn().mockReturnValue({
    recordAgentWrite: vi.fn(),
  }),
}));

import { AcceptChangesService } from '../main/accept-changes.service';

describe('AcceptChangesService.exportFiles', () => {
  let service: AcceptChangesService;
  const workspaceId = 'test-workspace-id' as WorkspaceId;
  const testWorkspace: Partial<Workspace> = {
    id: workspaceId,
    title: 'Test Workspace',
    worktreePath: '/source/worktree',
    branch: 'feature-branch',
    baseRef: 'main',
    status: WorkspaceStatus.Active,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AcceptChangesService();
    mockFindById.mockResolvedValue(testWorkspace);
    mockFsMkdir.mockResolvedValue(undefined);
    mockFsCopyFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper to set up git command mocks
  function setupGitMocks(options: {
    committedFiles?: string[];
    stagedFiles?: string[];
    unstagedFiles?: string[];
    untrackedFiles?: string[];
    ignoredFiles?: string[];
    checkIgnoreFails?: boolean;
  }) {
    const {
      committedFiles = [],
      stagedFiles = [],
      unstagedFiles = [],
      untrackedFiles = [],
      ignoredFiles = [],
      checkIgnoreFails = false,
    } = options;

    mockExecAsync.mockImplementation(async (command: string) => {
      if (command.includes('git diff --name-only') && command.includes('...')) {
        return { stdout: committedFiles.join('\n'), stderr: '' };
      }
      if (command.includes('git diff --cached --name-only')) {
        return { stdout: stagedFiles.join('\n'), stderr: '' };
      }
      if (command === 'git diff --name-only' || command.includes('git diff --name-only\n')) {
        return { stdout: unstagedFiles.join('\n'), stderr: '' };
      }
      if (command.includes('git ls-files --others')) {
        return { stdout: untrackedFiles.join('\n'), stderr: '' };
      }
      if (command.includes('git check-ignore')) {
        if (checkIgnoreFails) {
          throw new Error('git check-ignore failed');
        }
        return { stdout: ignoredFiles.join('\n'), stderr: '' };
      }
      if (command.includes('git rev-list')) {
        return { stdout: '0\t0', stderr: '' };
      }
      if (command.includes('git remote get-url')) {
        return { stdout: 'https://github.com/test/repo', stderr: '' };
      }
      if (command.includes('git branch -r')) {
        return { stdout: 'origin/main', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
  }

  it('should filter out gitignored files from export', async () => {
    setupGitMocks({
      committedFiles: ['src/app.ts', 'node_modules/package/index.js', 'dist/bundle.js'],
      ignoredFiles: ['node_modules/package/index.js', 'dist/bundle.js'],
    });

    const result = await service.exportFiles({
      workspaceId,
      targetPath: '/target/path',
      preserveStructure: true,
    });

    expect(result.success).toBe(true);
    expect(result.exportedFiles).toContain('src/app.ts');
    expect(result.exportedFiles).not.toContain('node_modules/package/index.js');
    expect(result.exportedFiles).not.toContain('dist/bundle.js');
  });

  it('should handle when no files are gitignored', async () => {
    setupGitMocks({
      committedFiles: ['src/app.ts', 'src/utils.ts'],
      ignoredFiles: [], // No ignored files
    });

    const result = await service.exportFiles({
      workspaceId,
      targetPath: '/target/path',
      preserveStructure: true,
    });

    expect(result.success).toBe(true);
    expect(result.exportedFiles).toContain('src/app.ts');
    expect(result.exportedFiles).toContain('src/utils.ts');
    expect(result.exportedFiles).toHaveLength(2);
  });

  it('should handle git check-ignore command failure gracefully', async () => {
    setupGitMocks({
      committedFiles: ['src/app.ts', 'src/config.ts'],
      checkIgnoreFails: true, // Simulate command failure
    });

    const result = await service.exportFiles({
      workspaceId,
      targetPath: '/target/path',
      preserveStructure: true,
    });

    // Should still export files despite check-ignore failure
    expect(result.success).toBe(true);
    expect(result.exportedFiles).toContain('src/app.ts');
    expect(result.exportedFiles).toContain('src/config.ts');
  });

  it('should use execFileAsync for staging (not execAsync with shell)', async () => {
    setupGitMocks({
      stagedFiles: ['src/staged-file.ts'],
    });

    await service.exportFiles({
      workspaceId,
      targetPath: '/target/path',
      preserveStructure: true,
    });

    // Verify execFileAsync was called for git add (safer, no shell)
    const gitAddCall = mockExecFileAsync.mock.calls.find(
      (call) => call[0] === 'git' && call[1]?.[0] === 'add',
    );
    expect(gitAddCall).toBeDefined();
    expect(gitAddCall?.[0]).toBe('git');
    expect(gitAddCall?.[1]).toContain('add');
    expect(gitAddCall?.[1]).toContain('--');
    expect(gitAddCall?.[1]).toContain('src/staged-file.ts');
  });

  it('should properly escape single quotes and backslashes in file paths', async () => {
    const fileWithQuote = "src/file'with'quotes.ts";
    const fileWithBackslash = 'src/file\\with\\backslash.ts';

    setupGitMocks({
      committedFiles: [fileWithQuote, fileWithBackslash],
    });

    await service.exportFiles({
      workspaceId,
      targetPath: '/target/path',
      preserveStructure: true,
    });

    // Find the git check-ignore call to verify escaping
    const checkIgnoreCall = mockExecAsync.mock.calls.find((call) =>
      call[0]?.includes('git check-ignore'),
    );
    expect(checkIgnoreCall).toBeDefined();

    const command = checkIgnoreCall?.[0] as string;
    // Verify backslashes are escaped (\ becomes \\)
    expect(command).toContain('\\\\');
    // Verify single quotes are escaped using shell escaping pattern ('\'')
    expect(command).toContain("'\\''");
  });

  it('should apply gitignore filter to user-provided files (request.files)', async () => {
    const userFiles = ['src/keep.ts', 'node_modules/ignored.js', 'src/also-keep.ts'];

    setupGitMocks({
      committedFiles: [], // No auto-detected files
      ignoredFiles: ['node_modules/ignored.js'],
    });

    const result = await service.exportFiles({
      workspaceId,
      targetPath: '/target/path',
      files: userFiles, // User-provided files
      preserveStructure: true,
    });

    expect(result.success).toBe(true);
    expect(result.exportedFiles).toContain('src/keep.ts');
    expect(result.exportedFiles).toContain('src/also-keep.ts');
    expect(result.exportedFiles).not.toContain('node_modules/ignored.js');
  });

  it('should stage files in target that were staged in source', async () => {
    setupGitMocks({
      stagedFiles: ['src/staged1.ts', 'src/staged2.ts'],
      unstagedFiles: ['src/unstaged.ts'],
    });

    await service.exportFiles({
      workspaceId,
      targetPath: '/target/path',
      preserveStructure: true,
    });

    // Verify execFileAsync was called with only staged files
    const gitAddCall = mockExecFileAsync.mock.calls.find(
      (call) => call[0] === 'git' && call[1]?.[0] === 'add',
    );
    expect(gitAddCall).toBeDefined();

    const stagedInCall = gitAddCall?.[1] as string[];
    expect(stagedInCall).toContain('src/staged1.ts');
    expect(stagedInCall).toContain('src/staged2.ts');
    // Unstaged files should not be in the git add call
    expect(stagedInCall).not.toContain('src/unstaged.ts');
  });

  it('should return error when workspace not found', async () => {
    mockFindById.mockResolvedValue(null);

    const result = await service.exportFiles({
      workspaceId,
      targetPath: '/target/path',
      preserveStructure: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Workspace not found');
  });

  it('should return error when workspace has no worktree path', async () => {
    mockFindById.mockResolvedValue({
      ...testWorkspace,
      worktreePath: undefined,
      path: undefined,
    });

    const result = await service.exportFiles({
      workspaceId,
      targetPath: '/target/path',
      preserveStructure: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Workspace has no worktree path');
  });
});


describe('AcceptChangesService.execute - PR operation completion', () => {
  let service: AcceptChangesService;
  const workspaceId = 'test-workspace-id' as WorkspaceId;
  const testWorkspace: Partial<Workspace> = {
    id: workspaceId,
    title: 'Test Workspace',
    worktreePath: '/source/worktree',
    branch: 'feature-branch',
    baseRef: 'main',
    status: WorkspaceStatus.Active,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AcceptChangesService();
    mockFindById.mockResolvedValue(testWorkspace);

    // Default: registerOperation returns a unique ID
    mockRegisterOperation.mockReturnValue('test-op-id');

    // Mock git commands for getWorkspaceGitStatus
    mockExecAsync.mockImplementation(async (command: string) => {
      if (command.includes('git remote get-url')) {
        return { stdout: 'https://github.com/testowner/testrepo.git', stderr: '' };
      }
      if (command.includes('git fetch origin')) {
        return { stdout: '', stderr: '' };
      }
      if (command.includes('git rev-list')) {
        return { stdout: '0\t1', stderr: '' }; // 0 behind, 1 ahead
      }
      if (command.includes('git rev-parse HEAD^{tree}')) {
        return { stdout: 'abc123tree', stderr: '' };
      }
      if (command.includes('git merge-base') && !command.includes('--is-ancestor')) {
        return { stdout: 'mergebase123', stderr: '' };
      }
      if (command.includes('git log') && command.includes('--format=%T')) {
        return { stdout: 'differenttree', stderr: '' };
      }
      if (command.includes('git log') && command.includes('--format="%H')) {
        return { stdout: 'abc1234567890123456789012345678901234567|Test commit|Author|2024-01-01T00:00:00Z|\x00\x00', stderr: '' };
      }
      if (command.includes('git rev-parse --verify origin/')) {
        return { stdout: 'abc123', stderr: '' }; // branch is pushed
      }
      if (command.includes('git log') && command.includes('--format=%H')) {
        return { stdout: 'abc1234567890123456789012345678901234567', stderr: '' };
      }
      if (command.includes('git branch -r')) {
        return { stdout: 'origin/main', stderr: '' };
      }
      if (command.includes('git merge-base --is-ancestor')) {
        return { stdout: '', stderr: '' }; // no divergence
      }
      if (command.includes('git push')) {
        return { stdout: '', stderr: '' };
      }
      if (command.includes('git branch --unset-upstream')) {
        return { stdout: '', stderr: '' };
      }
      if (command.includes('git branch --set-upstream')) {
        return { stdout: '', stderr: '' };
      }
      if (command.includes('git update-ref')) {
        return { stdout: '', stderr: '' };
      }
      if (command.includes('git rev-parse HEAD')) {
        return { stdout: 'abc123headsha', stderr: '' };
      }
      if (command.includes('git merge-tree')) {
        return { stdout: '', stderr: '' }; // no conflicts
      }
      return { stdout: '', stderr: '' };
    });

    // gitService.getStatus returns no staged files by default
    mockGitServiceGetStatus.mockResolvedValue({ ok: true, data: { files: [] } });
    mockGitServiceCommit.mockResolvedValue({ ok: true, data: { hash: 'commit123' } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should call completeOperation with operationId for direct create-pr (new PR)', async () => {
    // Mock: no existing PRs
    mockGetPullRequests.mockResolvedValue([]);
    // Mock: PR creation succeeds
    mockCreatePullRequest.mockResolvedValue({
      number: 42,
      url: 'https://api.github.com/repos/testowner/testrepo/pulls/42',
      htmlUrl: 'https://github.com/testowner/testrepo/pull/42',
      title: 'Test PR',
    });

    const result = await service.execute({
      workspaceId,
      action: 'create-pr',
      prTitle: 'Test PR',
    });

    expect(result.success).toBe(true);
    expect(result.result?.prNumber).toBe(42);

    // The operationId registered for 'create-pr' should be used for completeOperation
    expect(mockRegisterOperation).toHaveBeenCalledWith(
      workspaceId,
      'create-pr',
      expect.any(Object),
    );
    expect(mockCompleteOperation).toHaveBeenCalledWith('test-op-id', {
      prNumber: 42,
      prUrl: 'https://github.com/testowner/testrepo/pull/42',
    });
  });

  it('should call completeOperation with operationId for direct create-pr (existing PR found)', async () => {
    // Mock: existing PR found
    mockGetPullRequests.mockResolvedValue([
      {
        number: 99,
        url: 'https://api.github.com/repos/testowner/testrepo/pulls/99',
        htmlUrl: 'https://github.com/testowner/testrepo/pull/99',
        title: 'Existing PR',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    ]);

    const result = await service.execute({
      workspaceId,
      action: 'create-pr',
      prTitle: 'Test PR',
    });

    expect(result.success).toBe(true);
    expect(result.result?.existingPR).toBe(true);
    expect(result.result?.prNumber).toBe(99);

    // completeOperation should be called with the original operationId
    expect(mockCompleteOperation).toHaveBeenCalledWith('test-op-id', {
      prNumber: 99,
      prUrl: 'https://github.com/testowner/testrepo/pull/99',
    });
  });

  it('should call failOperation with operationId for direct create-pr (failure)', async () => {
    // Mock: no existing PRs
    mockGetPullRequests.mockResolvedValue([]);
    // Mock: PR creation fails
    mockCreatePullRequest.mockRejectedValue(new Error('GitHub API error'));

    const result = await service.execute({
      workspaceId,
      action: 'create-pr',
      prTitle: 'Test PR',
    });

    expect(result.success).toBe(false);

    // failOperation should be called with the original operationId
    expect(mockFailOperation).toHaveBeenCalledWith(
      'test-op-id',
      expect.stringContaining('Failed to create pull request'),
    );
  });

  it('should use new prOperationId (not original operationId) for createPRAfterPush flow', async () => {
    // For createPRAfterPush, the flow is:
    // 1. Register push operation -> operationId
    // 2. Push succeeds -> completeOperation(operationId)
    // 3. Register new PR operation -> prOperationId
    // 4. PR creation succeeds -> completeOperation(prOperationId)
    let callCount = 0;
    mockRegisterOperation.mockImplementation(() => {
      callCount++;
      return callCount === 1 ? 'push-op-id' : 'pr-op-id';
    });

    // Mock: no existing PRs
    mockGetPullRequests.mockResolvedValue([]);
    // Mock: PR creation succeeds
    mockCreatePullRequest.mockResolvedValue({
      number: 55,
      url: 'https://api.github.com/repos/testowner/testrepo/pulls/55',
      htmlUrl: 'https://github.com/testowner/testrepo/pull/55',
      title: 'Test PR',
    });

    const result = await service.execute({
      workspaceId,
      action: 'push',
      prTitle: 'Test PR',
      options: {
        createPRAfterPush: true,
      },
    });

    expect(result.success).toBe(true);
    expect(result.result?.prNumber).toBe(55);

    // First registerOperation is for push, second is for create-pr
    expect(mockRegisterOperation).toHaveBeenCalledTimes(2);
    expect(mockRegisterOperation).toHaveBeenNthCalledWith(1, workspaceId, 'push', expect.any(Object));
    expect(mockRegisterOperation).toHaveBeenNthCalledWith(2, workspaceId, 'create-pr', expect.any(Object));

    // The push operation should be completed first (with push-op-id)
    expect(mockCompleteOperation).toHaveBeenCalledWith('push-op-id');

    // The PR operation should be completed with the NEW prOperationId (pr-op-id), NOT push-op-id
    expect(mockCompleteOperation).toHaveBeenCalledWith('pr-op-id', {
      prNumber: 55,
      prUrl: 'https://github.com/testowner/testrepo/pull/55',
    });
  });
});



describe('getWorkspaceGitStatus - isContentMergedToTrunk detection', () => {
  let service: AcceptChangesService;
  const workspaceId = 'test-workspace-id' as WorkspaceId;
  const testWorkspace: Partial<Workspace> = {
    id: workspaceId,
    title: 'Test Workspace',
    worktreePath: '/source/worktree',
    branch: 'feature-branch',
    baseRef: 'main',
    status: WorkspaceStatus.Active,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AcceptChangesService();
    mockFindById.mockResolvedValue(testWorkspace);
    mockGitServiceGetStatus.mockResolvedValue({ ok: true, data: { files: [] } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setupGitStatusMocks(options: {
    revListOutput: string;
    branchTree?: string;
    mergeBase?: string;
    trunkTrees?: string;
  }) {
    const {
      revListOutput,
      branchTree = 'abc123tree',
      mergeBase = 'mergebase123',
      trunkTrees = 'differenttree',
    } = options;

    mockExecAsync.mockImplementation(async (command: string) => {
      if (command.includes('git remote get-url')) {
        return { stdout: 'https://github.com/testowner/testrepo.git', stderr: '' };
      }
      if (command.includes('git fetch origin')) {
        return { stdout: '', stderr: '' };
      }
      if (command.includes('git rev-list')) {
        return { stdout: revListOutput, stderr: '' };
      }
      if (command.includes('git rev-parse HEAD^{tree}')) {
        return { stdout: branchTree, stderr: '' };
      }
      if (command.includes('git merge-base') && !command.includes('--is-ancestor')) {
        return { stdout: mergeBase, stderr: '' };
      }
      if (command.includes('git log') && command.includes('--format=%T')) {
        return { stdout: trunkTrees, stderr: '' };
      }
      if (command.includes('git log') && command.includes('--format="%H')) {
        return { stdout: '', stderr: '' };
      }
      if (command.includes('git rev-parse --verify origin/')) {
        return { stdout: 'abc123', stderr: '' };
      }
      if (command.includes('git log') && command.includes('--format=%H')) {
        return { stdout: '', stderr: '' };
      }
      if (command.includes('git branch -r')) {
        return { stdout: 'origin/main', stderr: '' };
      }
      if (command.includes('git merge-base --is-ancestor')) {
        return { stdout: '', stderr: '' };
      }
      if (command.includes('git merge-tree')) {
        return { stdout: '', stderr: '' };
      }
      if (command.includes('git rev-parse HEAD')) {
        return { stdout: 'abc123headsha', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });
  }

  it('sets isContentMergedToTrunk=true when aheadOfTrunk===0 and behindTrunk>0', async () => {
    setupGitStatusMocks({ revListOutput: '5\t0' }); // 5 behind, 0 ahead

    const result = await service.getWorkspaceGitStatus(workspaceId);

    expect(result.isContentMergedToTrunk).toBe(true);
    expect(result.aheadOfTrunk).toBe(0);
    expect(result.behindTrunk).toBe(5);
  });

  it('does NOT set isContentMergedToTrunk when aheadOfTrunk===0 and behindTrunk===0', async () => {
    setupGitStatusMocks({ revListOutput: '0\t0' }); // 0 behind, 0 ahead

    const result = await service.getWorkspaceGitStatus(workspaceId);

    expect(result.isContentMergedToTrunk).toBe(false);
    expect(result.aheadOfTrunk).toBe(0);
    expect(result.behindTrunk).toBe(0);
  });

  it('still detects squash merge via tree hash when aheadOfTrunk>0', async () => {
    setupGitStatusMocks({
      revListOutput: '3\t2', // 3 behind, 2 ahead
      branchTree: 'matching-tree-hash',
      trunkTrees: 'matching-tree-hash', // tree hash matches
    });

    const result = await service.getWorkspaceGitStatus(workspaceId);

    expect(result.isContentMergedToTrunk).toBe(true);
    expect(result.aheadOfTrunk).toBe(2);
    expect(result.behindTrunk).toBe(3);
  });

  it('does NOT set isContentMergedToTrunk when aheadOfTrunk>0 and tree hashes do not match', async () => {
    setupGitStatusMocks({
      revListOutput: '0\t2', // 0 behind, 2 ahead
      branchTree: 'branch-tree-hash',
      trunkTrees: 'different-trunk-tree-hash', // tree hashes differ
    });

    const result = await service.getWorkspaceGitStatus(workspaceId);

    expect(result.isContentMergedToTrunk).toBe(false);
    expect(result.aheadOfTrunk).toBe(2);
    expect(result.behindTrunk).toBe(0);
  });
});

describe('AcceptChangesService.detectMergeConflicts', () => {
  let service: AcceptChangesService;
  const workspaceId = 'test-workspace-id' as WorkspaceId;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AcceptChangesService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return false when modern merge-tree --write-tree succeeds (no conflicts)', async () => {
    mockExecAsync.mockResolvedValueOnce({ stdout: 'abc123tree', stderr: '' });

    const result = await (service as any).detectMergeConflicts(
      workspaceId,
      '/test/worktree',
      'feature-branch',
      'origin/main',
    );

    expect(result).toBe(false);
    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringContaining('git merge-tree --write-tree'),
      expect.any(Object),
    );
  });

  it('should return true when merge-tree --write-tree exits with code 1 (conflicts)', async () => {
    const error = new Error('merge-tree failed') as any;
    error.code = 1;
    mockExecAsync.mockRejectedValueOnce(error);

    const result = await (service as any).detectMergeConflicts(
      workspaceId,
      '/test/worktree',
      'feature-branch',
      'origin/main',
    );

    expect(result).toBe(true);
  });

  it('should fall back to legacy merge-tree when --write-tree is unsupported (no conflicts)', async () => {
    // First call: --write-tree fails with "unknown option"
    const unsupportedError = new Error('unknown option `write-tree\'');
    mockExecAsync.mockRejectedValueOnce(unsupportedError);
    // Second call: merge-base
    mockExecAsync.mockResolvedValueOnce({ stdout: 'base-sha\n', stderr: '' });
    // Third call: legacy merge-tree (no conflict markers)
    mockExecAsync.mockResolvedValueOnce({ stdout: 'clean merge output\n', stderr: '' });

    const result = await (service as any).detectMergeConflicts(
      workspaceId,
      '/test/worktree',
      'feature-branch',
      'origin/main',
    );

    expect(result).toBe(false);
    // Verify legacy merge-base was called
    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringContaining('git merge-base'),
      expect.any(Object),
    );
  });

  it('should return true via legacy fallback when conflict markers are present', async () => {
    // First call: --write-tree fails with "unrecognized argument"
    const unsupportedError = new Error('unrecognized argument: --write-tree');
    mockExecAsync.mockRejectedValueOnce(unsupportedError);
    // Second call: merge-base
    mockExecAsync.mockResolvedValueOnce({ stdout: 'base-sha\n', stderr: '' });
    // Third call: legacy merge-tree with conflict markers
    mockExecAsync.mockResolvedValueOnce({
      stdout: '<<<<<<< ours\nsome content\n=======\nother content\n>>>>>>> theirs\n',
      stderr: '',
    });

    const result = await (service as any).detectMergeConflicts(
      workspaceId,
      '/test/worktree',
      'feature-branch',
      'origin/main',
    );

    expect(result).toBe(true);
  });

  it('should return false on other errors (code 128) to avoid blocking operations', async () => {
    const error = new Error('fatal: not a git repository') as any;
    error.code = 128;
    mockExecAsync.mockRejectedValueOnce(error);

    const result = await (service as any).detectMergeConflicts(
      workspaceId,
      '/test/worktree',
      'feature-branch',
      'origin/main',
    );

    expect(result).toBe(false);
  });
});

describe('AcceptChangesService.execute - merge flow calls detectMergeConflicts after fetch', () => {
  let service: AcceptChangesService;
  const workspaceId = 'test-workspace-id' as WorkspaceId;
  const testWorkspace: Partial<Workspace> = {
    id: workspaceId,
    title: 'Test Workspace',
    worktreePath: '/source/worktree',
    branch: 'feature-branch',
    baseRef: 'main',
    status: WorkspaceStatus.Active,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AcceptChangesService();
    mockFindById.mockResolvedValue(testWorkspace);
    mockRegisterOperation.mockReturnValue('test-op-id');
    mockGitServiceGetStatus.mockResolvedValue({ ok: true, data: { files: [] } });
    mockGitServiceCommit.mockResolvedValue({ ok: true, data: { hash: 'commit123' } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should call git fetch before detectMergeConflicts in merge flow', async () => {
    const callOrder: string[] = [];

    mockExecAsync.mockImplementation(async (command: string) => {
      if (command.includes('git remote get-url')) {
        return { stdout: 'https://github.com/testowner/testrepo.git', stderr: '' };
      }
      if (command.includes('git fetch origin')) {
        callOrder.push('fetch');
        return { stdout: '', stderr: '' };
      }
      if (command.includes('git rev-list')) {
        return { stdout: '2\t1', stderr: '' }; // 2 behind trunk (triggers conflict check)
      }
      if (command.includes('git rev-parse HEAD^{tree}')) {
        return { stdout: 'abc123tree', stderr: '' };
      }
      if (command.includes('git merge-base') && !command.includes('--is-ancestor')) {
        return { stdout: 'mergebase123', stderr: '' };
      }
      if (command.includes('git log') && command.includes('--format=%T')) {
        return { stdout: 'differenttree', stderr: '' };
      }
      if (command.includes('git log') && command.includes('--format="%H')) {
        return { stdout: 'abc1234567890123456789012345678901234567|Test commit|Author|2024-01-01T00:00:00Z|\x00\x00', stderr: '' };
      }
      if (command.includes('git rev-parse --verify origin/')) {
        return { stdout: 'abc123', stderr: '' };
      }
      if (command.includes('git log') && command.includes('--format=%H')) {
        return { stdout: 'abc1234567890123456789012345678901234567', stderr: '' };
      }
      if (command.includes('git branch -r')) {
        return { stdout: 'origin/main', stderr: '' };
      }
      if (command.includes('git merge-tree --write-tree')) {
        callOrder.push('merge-tree');
        return { stdout: '', stderr: '' }; // no conflicts
      }
      if (command.includes('git merge-base --is-ancestor')) {
        return { stdout: '', stderr: '' };
      }
      if (command.includes('git ls-remote')) {
        return { stdout: 'abc123\trefs/heads/main', stderr: '' };
      }
      if (command.includes('git push')) {
        return { stdout: '', stderr: '' };
      }
      if (command.includes('git branch --unset-upstream')) {
        return { stdout: '', stderr: '' };
      }
      if (command.includes('git branch --set-upstream')) {
        return { stdout: '', stderr: '' };
      }
      if (command.includes('git update-ref')) {
        return { stdout: '', stderr: '' };
      }
      if (command.includes('git rev-parse HEAD')) {
        return { stdout: 'abc123headsha', stderr: '' };
      }
      if (command.includes('git rev-parse')) {
        return { stdout: 'abc123', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    await service.execute({
      workspaceId,
      action: 'merge',
    });

    // Verify fetch happens before merge-tree conflict check
    const fetchIndex = callOrder.indexOf('fetch');
    const mergeTreeIndex = callOrder.indexOf('merge-tree');

    expect(fetchIndex).toBeGreaterThanOrEqual(0);
    expect(mergeTreeIndex).toBeGreaterThanOrEqual(0);
    expect(fetchIndex).toBeLessThan(mergeTreeIndex);
  });
});