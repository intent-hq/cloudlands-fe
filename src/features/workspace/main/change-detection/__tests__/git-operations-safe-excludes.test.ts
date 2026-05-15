import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { GitOperationsSafe } from '../git-operations-safe-wrapper';

const mockGitStatus = vi.hoisted(() => vi.fn());
const mockLoggerDebug = vi.hoisted(() => vi.fn());

vi.mock('../safe-git-operations', () => ({
  execGitCommand: vi.fn(),
  gitStatus: mockGitStatus,
  gitDiff: vi.fn(),
  gitDiffBatch: vi.fn(),
  gitCheckIgnore: vi.fn(),
  gitCurrentBranch: vi.fn(),
  isGitRepository: vi.fn(),
}));

vi.mock('../../../../../shared/logger', () => ({
  Logger: vi.fn(function Logger() {
    return {
      debug: mockLoggerDebug,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  }),
}));

describe('GitOperationsSafe default file-tracking excludes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters only untracked generated dependency files from git status', async () => {
    mockGitStatus.mockResolvedValue({
      stdout: [
        '?? venv/lib/python3.11/site-packages/pkg.py',
        '?? .venv/lib/python3.11/site-packages/pkg.py',
        '?? src/venv_utils.ts',
        '?? tests/fixtures/venv-example.txt',
        '?? environment/config.py',
        ' M venv/lib/python3.11/site-packages/tracked-modified.py',
        'A  .venv/lib/python3.11/site-packages/staged-added.py',
        'D  venv/lib/python3.11/site-packages/staged-deleted.py',
        ' D .venv/lib/python3.11/site-packages/unstaged-deleted.py',
      ].join('\n'),
      stderr: '',
      exitCode: 0,
    });

    const gitOperations = new GitOperationsSafe(process.cwd());
    const status = await gitOperations.getStatus();

    expect(status.untracked).toEqual([
      'src/venv_utils.ts',
      'tests/fixtures/venv-example.txt',
      'environment/config.py',
    ]);
    expect(status.unstaged).toEqual(['venv/lib/python3.11/site-packages/tracked-modified.py']);
    expect(status.stagedAdded).toEqual(['.venv/lib/python3.11/site-packages/staged-added.py']);
    expect(status.stagedDeleted).toEqual(['venv/lib/python3.11/site-packages/staged-deleted.py']);
    expect(status.deleted).toEqual(['.venv/lib/python3.11/site-packages/unstaged-deleted.py']);

    const summaryCalls = mockLoggerDebug.mock.calls.filter(
      ([message]) => message === 'Skipped default-excluded untracked files from git status',
    );
    expect(summaryCalls).toHaveLength(1);
    expect(summaryCalls[0][1]).toMatchObject({
      skippedCount: 2,
      skippedSample: [
        'venv/lib/python3.11/site-packages/pkg.py',
        '.venv/lib/python3.11/site-packages/pkg.py',
      ],
    });
  });
});
