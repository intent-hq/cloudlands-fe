import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { GitIntegrationService } from '../main/git-integration.service';
import { ChangeStage } from '../types';

const mockLoggerDebug = vi.hoisted(() => vi.fn());
const mockUuid = vi.hoisted(() => vi.fn());

vi.mock('$lib/utils/logger', () => ({
  Logger: vi.fn(function Logger() {
    return {
      debug: mockLoggerDebug,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  }),
}));

vi.mock('uuid', () => ({
  v4: mockUuid,
}));

vi.mock('../../workspace/main/provenance/attribution-engine', () => ({
  getAttributionEngine: vi.fn(() => ({
    loadAgentWrites: vi.fn().mockResolvedValue(undefined),
    attributeChange: vi.fn().mockResolvedValue({ source: 'user' }),
  })),
}));

vi.mock('../../../shared/git/git-blob-storage', () => ({
  isGitRepository: vi.fn().mockResolvedValue(false),
  storeBlob: vi.fn().mockResolvedValue(undefined),
}));

describe('GitIntegrationService default file-tracking excludes', () => {
  let fileTrackingService: any;
  let service: GitIntegrationService;
  let uuidCounter = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    mockUuid.mockImplementation(() => `tracked-change-${++uuidCounter}`);
    fileTrackingService = {
      getChanges: vi.fn().mockResolvedValue({ changes: [] }),
      trackChangesBatch: vi.fn().mockResolvedValue([]),
      clearFileStageEntriesBatch: vi.fn().mockResolvedValue(undefined),
    };
    service = new GitIntegrationService('workspace-1', '/workspace', fileTrackingService);
  });

  it('filters untracked generated paths before tracked changes are stored', async () => {
    await (service as any).handleGitChanges(
      {
        id: 'change-1',
        provenance: { source: 'git' },
        files: [
          {
            path: 'venv/lib/python/site-packages/pkg.py',
            action: 'Create',
            stage: ChangeStage.Unstaged,
          },
          { path: '__pycache__/module.pyc', action: 'Create', stage: ChangeStage.Unstaged },
          {
            path: 'google-cloud-sdk/platform/gsutil/gslib/__init__.py',
            action: 'Create',
            stage: ChangeStage.Unstaged,
          },
          { path: 'src/venv_utils.ts', action: 'Create', stage: ChangeStage.Unstaged },
          {
            path: 'node_modules/local-package/index.ts',
            action: 'Create',
            stage: ChangeStage.Staged,
          },
          { path: 'venv/tracked.py', action: 'Delete', stage: ChangeStage.Unstaged },
        ],
      },
      false,
    );

    expect(fileTrackingService.trackChangesBatch).toHaveBeenCalledTimes(1);
    const trackedFiles = fileTrackingService.trackChangesBatch.mock.calls[0][0].map(
      (change: any) => change.file,
    );
    expect(trackedFiles).toEqual([
      'src/venv_utils.ts',
      'node_modules/local-package/index.ts',
      'venv/tracked.py',
    ]);
  });

  it('does not store anything when all incoming files are default-excluded untracked files', async () => {
    await (service as any).handleGitChanges(
      {
        id: 'change-2',
        provenance: { source: 'git' },
        files: [
          {
            path: 'venv/lib/python/site-packages/pkg.py',
            action: 'Create',
            stage: ChangeStage.Unstaged,
          },
          { path: 'node_modules/pkg/index.js', action: 'Create', stage: ChangeStage.Unstaged },
        ],
      },
      false,
    );

    expect(fileTrackingService.trackChangesBatch).not.toHaveBeenCalled();
    expect(mockUuid).not.toHaveBeenCalled();
  });

  it('filters virtualenv-heavy batches before TrackedChange construction and logs one summary', async () => {
    const ignoredFiles = Array.from({ length: 1200 }, (_, index) => ({
      path: `${index % 2 === 0 ? 'venv' : '.venv'}/lib/python3.11/site-packages/pkg_${index}.py`,
      action: 'Create',
      stage: ChangeStage.Unstaged,
      additions: 1,
    }));

    await (service as any).handleGitChanges(
      {
        id: 'change-heavy-virtualenv',
        provenance: { source: 'git' },
        files: [
          ...ignoredFiles,
          { path: 'environment/config.py', action: 'Create', stage: ChangeStage.Unstaged },
        ],
      },
      false,
    );

    expect(mockUuid).toHaveBeenCalledTimes(1);
    expect(fileTrackingService.trackChangesBatch).toHaveBeenCalledTimes(1);
    expect(fileTrackingService.trackChangesBatch.mock.calls[0][0]).toHaveLength(1);
    expect(fileTrackingService.trackChangesBatch.mock.calls[0][0][0]).toMatchObject({
      id: 'tracked-change-1',
      file: 'environment/config.py',
      status: 'added',
    });

    const summaryCalls = mockLoggerDebug.mock.calls.filter(
      ([message]) => message === 'Skipped default-excluded untracked files before tracking',
    );
    expect(summaryCalls).toHaveLength(1);
    expect(summaryCalls[0][1]).toMatchObject({
      workspaceId: 'workspace-1',
      changeId: 'change-heavy-virtualenv',
      skippedCount: 1200,
      skippedSample: ignoredFiles.slice(0, 5).map((file) => file.path),
    });

    const processingCall = mockLoggerDebug.mock.calls.find(
      ([message]) => message === 'Processing git changes',
    );
    expect(processingCall?.[1]).toMatchObject({
      fileCount: 1201,
      filteredFileCount: 1,
    });

    const trackingCalls = mockLoggerDebug.mock.calls.filter(
      ([message]) => message === 'Tracking change',
    );
    expect(trackingCalls).toHaveLength(1);
    expect(trackingCalls[0][1]).toMatchObject({ file: 'environment/config.py' });
  });
});

describe('GitIntegrationService startup catch-up', () => {
  let fileTrackingService: any;
  let service: GitIntegrationService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUuid.mockReturnValue('tracked-change-startup');
    fileTrackingService = {
      getChanges: vi.fn().mockResolvedValue({ changes: [] }),
      trackChangesBatch: vi.fn().mockResolvedValue([]),
      clearFileStageEntriesBatch: vi.fn().mockResolvedValue(undefined),
    };
    service = new GitIntegrationService('workspace-1', '/workspace', fileTrackingService);
  });

  it('preserves fresh-workspace initial sync skip when the detector has not seen changes', async () => {
    const detector = {
      on: vi.fn(),
      getStats: vi.fn(() => ({ totalChangesDetected: 0 })),
      getCurrentChanges: vi.fn(),
    };

    await service.startListening(detector, { skipInitialSync: true });

    expect(detector.on).toHaveBeenCalledWith('changes', expect.any(Function));
    expect(detector.getCurrentChanges).not.toHaveBeenCalled();
    expect(fileTrackingService.trackChangesBatch).not.toHaveBeenCalled();
  });

  it('syncs once when fresh-workspace polling saw changes before the listener attached', async () => {
    const detector = {
      on: vi.fn(),
      getStats: vi.fn(() => ({ totalChangesDetected: 1 })),
      getCurrentChanges: vi.fn().mockResolvedValue({
        id: 'missed-change',
        provenance: { source: 'git' },
        files: [
          {
            path: 'src/app.ts',
            action: 'Modify',
            stage: ChangeStage.Unstaged,
            additions: 1,
            deletions: 1,
            content: 'fresh content',
          },
        ],
      }),
    };
    const changesTracked = vi.fn();
    service.on('changes-tracked', changesTracked);

    await service.startListening(detector, { skipInitialSync: true });

    expect(detector.getCurrentChanges).toHaveBeenCalledTimes(1);
    expect(fileTrackingService.trackChangesBatch).toHaveBeenCalledTimes(1);
    expect(fileTrackingService.trackChangesBatch.mock.calls[0][0][0]).toMatchObject({
      file: 'src/app.ts',
      stage: ChangeStage.Unstaged,
      content: { newContent: 'fresh content' },
    });
    expect(changesTracked).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      changeCount: 1,
      source: 'git',
    });
  });
});
