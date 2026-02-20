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
vi.mock('../../git/main/git.service', () => ({
  gitService: {
    getStatus: vi.fn().mockResolvedValue({ ok: true, data: { files: [] } }),
  },
}));

// Mock other dependencies
vi.mock('../../git-tracking/main/github.service', () => ({
  GitHubService: class {
    // Empty mock class
  },
}));

vi.mock('../../git/main/git-router', () => ({
  getWorkspaceGitInfo: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../shared/main/ssh-manager', () => ({
  sshManager: {},
}));

vi.mock('../../events/main/unified-event-bus', () => ({
  unifiedEventBus: { emitDomainEvent: vi.fn() },
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
