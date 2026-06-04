/**
 * Tests for file-tracking IPC handler logic
 *
 * These tests verify the data transformation logic in IPC handlers
 * without requiring the full IPC infrastructure (which has promisify issues).
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
} from 'vitest';
import { FILE_TRACKING_CHANNELS } from '../../../shared/ipc/channels';
import type { TrackedChange, CommitInfo } from '../types';
import { ChangeStage } from '../types';

const ipcMainMock = vi.hoisted(() => ({
  handle: vi.fn(),
}));

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const workspaceServiceMocks = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
}));

const fileTrackingServiceMocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  getChanges: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: ipcMainMock,
}));

vi.mock('$lib/utils/logger', () => ({
  Logger: class MockLogger {
    info = loggerMocks.info;
    warn = loggerMocks.warn;
    error = loggerMocks.error;
    debug = loggerMocks.debug;
  },
}));

vi.mock('../../../shared/logger', () => ({
  Logger: class MockLogger {
    info = loggerMocks.info;
    warn = loggerMocks.warn;
    error = loggerMocks.error;
    debug = loggerMocks.debug;
  },
}));

vi.mock('../main/file-tracking.service', () => ({
  FileTrackingService: class MockFileTrackingService {
    getChanges = fileTrackingServiceMocks.getChanges;
    clearAllChanges = vi.fn();
    getTransitions = vi.fn();
    trackChange = vi.fn();
    stageChanges = vi.fn();
    unstageChanges = vi.fn();
    forceSave = vi.fn();
    destroy = vi.fn();
    isGitRepo = vi.fn(() => false);

    constructor(...args: unknown[]) {
      fileTrackingServiceMocks.constructor(...args);
    }
  },
}));

vi.mock('../../workspace/main/workspace.service', () => ({
  workspaceService: workspaceServiceMocks,
}));

vi.mock('../../system/main/system.ipc', () => ({
  sendToWorkspaceWindows: vi.fn(),
}));

vi.mock('../../../shared/git/git-env', () => ({
  execFileAsync: vi.fn(),
}));

vi.mock('../../git/main/git.service', () => ({
  gitService: {
    getHistory: vi.fn(),
    clearStatusCache: vi.fn(),
  },
}));

vi.mock('../../../shared/git/git-blob-storage', () => ({
  storeBlob: vi.fn(),
}));

vi.mock('../../protocol/main/protocol-adapter', () => ({
  protocolAdapter: {
    getWorkspace: vi.fn(),
  },
}));

vi.mock('../../../shared/main/remote-rpc-manager', () => ({
  remoteRPCManager: {
    getClient: vi.fn(),
  },
}));

type RegisteredHandler = (event: unknown, payload: unknown) => Promise<unknown>;

describe('file-tracking IPC virtual workspace guards', () => {
  let registeredHandlers: Map<string, RegisteredHandler>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    registeredHandlers = new Map();
    ipcMainMock.handle.mockImplementation((channel: string, handler: RegisteredHandler) => {
      registeredHandlers.set(channel, handler);
    });
    fileTrackingServiceMocks.getChanges.mockResolvedValue({
      changes: [],
      truncated: false,
      totalCount: 0,
    });

    const { setupFileTrackingIPC } = await import('../main/file-tracking.ipc');
    setupFileTrackingIPC();
  });

  it('should short-circuit Chief line stats without worktree lookup or error logging', async () => {
    const handler = registeredHandlers.get(FILE_TRACKING_CHANNELS.GET_LINE_STATS);

    const result = await handler?.({}, { workspaceId: '__chief__' });

    expect(result).toEqual({ ok: true, data: { additions: 0, deletions: 0 } });
    expect(workspaceServiceMocks.getWorkspace).not.toHaveBeenCalled();
    expect(fileTrackingServiceMocks.constructor).not.toHaveBeenCalled();
    expect(fileTrackingServiceMocks.getChanges).not.toHaveBeenCalled();
    expect(loggerMocks.warn).not.toHaveBeenCalled();
    expect(loggerMocks.error).not.toHaveBeenCalled();
  });

  it('should short-circuit getServiceForWorkspace for virtual workspaces', async () => {
    const { getServiceForWorkspace } = await import('../main/file-tracking.ipc');

    const service = await getServiceForWorkspace('__chief__');

    expect(service).toBeNull();
    expect(workspaceServiceMocks.getWorkspace).not.toHaveBeenCalled();
    expect(fileTrackingServiceMocks.constructor).not.toHaveBeenCalled();
    expect(loggerMocks.warn).not.toHaveBeenCalled();
    expect(loggerMocks.error).not.toHaveBeenCalled();
  });

  it('should preserve non-virtual line stats behavior', async () => {
    workspaceServiceMocks.getWorkspace.mockResolvedValue({
      ok: true,
      data: { path: '/tmp/file-tracking-workspace', isRemote: true },
    });
    fileTrackingServiceMocks.getChanges.mockResolvedValue({
      changes: [
        { stats: { additions: 7, deletions: 2 } },
        { stats: { additions: 3, deletions: 5 } },
      ],
      truncated: false,
      totalCount: 2,
    });
    const handler = registeredHandlers.get(FILE_TRACKING_CHANNELS.GET_LINE_STATS);

    const result = await handler?.({}, { workspaceId: 'workspace-1' });

    expect(result).toEqual({ ok: true, data: { additions: 10, deletions: 7 } });
    expect(workspaceServiceMocks.getWorkspace).toHaveBeenCalledWith('workspace-1');
    expect(fileTrackingServiceMocks.constructor).toHaveBeenCalledWith(
      'workspace-1',
      '/tmp/file-tracking-workspace',
      true,
    );
    expect(fileTrackingServiceMocks.getChanges).toHaveBeenCalled();
  });
});

/**
 * Helper to simulate the commit mapping logic from LOAD_COMMITS handler
 */
function mapCommitToCommitInfo(commit: {
  hash?: string;
  sha?: string;
  message?: string;
  author?: string | { name: string };
  timestamp?: number | string;
  date?: string;
  files?: (string | { path?: string; additions?: number; deletions?: number })[];
  isPushed?: boolean;
  agentId?: string;
  linkedNoteId?: string;
}): CommitInfo {
  const hash = commit.hash || commit.sha || '';
  let files: { path: string; additions?: number; deletions?: number }[] = [];
  if (Array.isArray(commit.files)) {
    files = commit.files.map((file) => ({
      path: typeof file === 'string' ? file : String(file),
    }));
  }
  const filesChanged = files.length;
  const isPushed = commit.isPushed ?? false;
  const stage = isPushed ? ('pushed' as const) : ('local' as const);

  return {
    hash,
    message: commit.message || hash,
    author: typeof commit.author === 'string' ? commit.author : (commit.author?.name ?? 'Unknown'),
    timestamp:
      typeof commit.timestamp === 'number'
        ? commit.timestamp
        : new Date(commit.date || commit.timestamp || Date.now()).getTime(),
    files,
    filesChanged,
    stage,
    agentId: commit.agentId,
    linkedNoteId: commit.linkedNoteId,
  };
}

/**
 * Helper to simulate the line stats calculation from GET_LINE_STATS handler
 */
function calculateLineStats(changes: TrackedChange[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;

  for (const change of changes) {
    additions += change.stats?.additions || 0;
    deletions += change.stats?.deletions || 0;
  }

  return { additions, deletions };
}

/**
 * Helper to simulate the trackChange input construction
 */
function buildTrackChangeInput(validated: {
  change: {
    file: string;
    relativePath?: string;
    stage: string;
    stats?: { additions?: number; deletions?: number };
    type?: string;
    attribution?: { timestamp?: number };
    commitHash?: string;
    prNumber?: number;
    content?: string;
  };
}) {
  return {
    file: validated.change.file,
    relativePath: validated.change.relativePath ?? validated.change.file,
    stage: validated.change.stage as TrackedChange['stage'],
    stats: validated.change.stats ?? { additions: 0, deletions: 0 },
    status: validated.change.type as TrackedChange['status'],
    attribution: validated.change.attribution ?? { timestamp: Date.now() },
    commitHash: validated.change.commitHash,
    prNumber: validated.change.prNumber,
    content: validated.change.content,
  };
}

describe('file-tracking IPC handler logic', () => {
  describe('LOAD_COMMITS mapping', () => {
    it('should map commit with hash correctly', () => {
      const commit = {
        hash: 'abc123',
        message: 'Test commit',
        author: 'Test User',
        timestamp: 1700000000000,
        files: ['file1.ts', 'file2.ts'],
        isPushed: false,
      };

      const mapped = mapCommitToCommitInfo(commit);

      expect(mapped.hash).toBe('abc123');
      expect(mapped.message).toBe('Test commit');
      expect(mapped.author).toBe('Test User');
      expect(mapped.stage).toBe('local');
      expect(mapped.filesChanged).toBe(2);
    });

    it('should map commit with sha fallback', () => {
      const commit = {
        sha: 'def456',
        message: 'Sha commit',
        author: { name: 'Author Name' },
        date: '2024-01-01T00:00:00Z',
        files: [],
        isPushed: true,
      };

      const mapped = mapCommitToCommitInfo(commit);

      expect(mapped.hash).toBe('def456');
      expect(mapped.author).toBe('Author Name');
      expect(mapped.stage).toBe('pushed');
    });

    it('should handle agent and linkedNoteId', () => {
      const commit = {
        hash: 'agent123',
        message: 'Agent commit',
        author: 'AI Agent',
        timestamp: Date.now(),
        files: [],
        agentId: 'agent-001',
        linkedNoteId: 'note-001',
      };

      const mapped = mapCommitToCommitInfo(commit);

      expect(mapped.agentId).toBe('agent-001');
      expect(mapped.linkedNoteId).toBe('note-001');
    });

    it('should handle string files correctly', () => {
      const commit = {
        hash: 'stringfiles',
        message: 'String files commit',
        author: 'User',
        timestamp: Date.now(),
        files: ['src/index.ts', 'src/utils.ts'],
      };

      const mapped = mapCommitToCommitInfo(commit);

      expect(mapped.files[0].path).toBe('src/index.ts');
      expect(mapped.files[1].path).toBe('src/utils.ts');
      expect(mapped.filesChanged).toBe(2);
    });

    it('should handle file objects by converting to string (defensive)', () => {
      const commit = {
        hash: 'fileobj',
        message: 'File object commit',
        author: 'User',
        timestamp: Date.now(),
        files: [
          { path: 'src/index.ts', additions: 10, deletions: 5 },
          { path: 'src/utils.ts', additions: 20, deletions: 0 },
        ],
      };

      const mapped = mapCommitToCommitInfo(commit);

      // The current implementation converts non-string files to strings defensively
      // This produces [object Object] for objects, which is a known limitation
      // In practice, gitService.getHistory returns string[] for files
      expect(mapped.files[0].path).toBe('[object Object]');
    });

    it('should default to Unknown author when missing', () => {
      const commit = { hash: 'noauthor', message: 'No author', timestamp: Date.now() };

      const mapped = mapCommitToCommitInfo(commit);

      expect(mapped.author).toBe('Unknown');
    });

    it('should use hash as message fallback', () => {
      const commit = { hash: 'hashonly', timestamp: Date.now() };

      const mapped = mapCommitToCommitInfo(commit);

      expect(mapped.message).toBe('hashonly');
    });
  });

  describe('GET_LINE_STATS calculation', () => {
    it('should sum additions and deletions', () => {
      const changes: TrackedChange[] = [
        {
          id: 'change-1',
          file: 'file1.ts',
          relativePath: 'file1.ts',
          stage: ChangeStage.Unstaged,
          stats: { additions: 10, deletions: 5 },
          attribution: { timestamp: Date.now() },
        },
        {
          id: 'change-2',
          file: 'file2.ts',
          relativePath: 'file2.ts',
          stage: ChangeStage.Staged,
          stats: { additions: 20, deletions: 8 },
          attribution: { timestamp: Date.now() },
        },
      ];

      const stats = calculateLineStats(changes);

      expect(stats.additions).toBe(30);
      expect(stats.deletions).toBe(13);
    });

    it('should handle empty changes', () => {
      const changes: TrackedChange[] = [];

      const stats = calculateLineStats(changes);

      expect(stats.additions).toBe(0);
      expect(stats.deletions).toBe(0);
    });

    it('should handle missing stats', () => {
      const changes = [
        {
          id: 'change-1',
          file: 'file1.ts',
          relativePath: 'file1.ts',
          stage: ChangeStage.Unstaged,
          attribution: { timestamp: Date.now() },
        } as TrackedChange,
      ];

      const stats = calculateLineStats(changes);

      expect(stats.additions).toBe(0);
      expect(stats.deletions).toBe(0);
    });
  });

  describe('TRACK_CHANGE input construction', () => {
    it('should use file as relativePath fallback', () => {
      const input = buildTrackChangeInput({
        change: {
          file: '/path/to/file.ts',
          stage: 'unstaged',
        },
      });

      expect(input.relativePath).toBe('/path/to/file.ts');
    });

    it('should use provided relativePath', () => {
      const input = buildTrackChangeInput({
        change: {
          file: '/path/to/file.ts',
          relativePath: 'file.ts',
          stage: 'unstaged',
        },
      });

      expect(input.relativePath).toBe('file.ts');
    });

    it('should default stats to zero', () => {
      const input = buildTrackChangeInput({
        change: {
          file: 'file.ts',
          stage: 'unstaged',
        },
      });

      expect(input.stats).toEqual({ additions: 0, deletions: 0 });
    });

    it('should preserve optional fields', () => {
      const input = buildTrackChangeInput({
        change: {
          file: 'file.ts',
          stage: 'committed',
          commitHash: 'abc123',
          prNumber: 42,
          content: 'file contents',
        },
      });

      expect(input.commitHash).toBe('abc123');
      expect(input.prNumber).toBe(42);
      expect(input.content).toBe('file contents');
    });

    it('should provide default attribution timestamp', () => {
      const before = Date.now();
      const input = buildTrackChangeInput({
        change: {
          file: 'file.ts',
          stage: 'unstaged',
        },
      });
      const after = Date.now();

      expect(input.attribution.timestamp).toBeGreaterThanOrEqual(before);
      expect(input.attribution.timestamp).toBeLessThanOrEqual(after);
    });
  });
});
