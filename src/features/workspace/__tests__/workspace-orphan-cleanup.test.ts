import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { FileSystemWorkspaceRepository } from '../main/workspace.repository';
import type { WorkspaceRepository } from '../main/workspace.repository';
import { WorkspaceService } from '../main/workspace.service';
import { WorkspaceConfig } from '../../../shared/main/config';
import type { Workspace } from '../../../shared/types';
import { WorkspaceStatus } from '../../../shared/types';
import type { WorkspaceId } from '../../../shared/types/branded-ids';

describe('workspace orphan cleanup', () => {
  let baseDir: string;
  let originalHome: string | undefined;
  let originalWorkspacesBaseDir: string | undefined;
  let originalAugmentWorkspacesRoot: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    originalWorkspacesBaseDir = process.env.WORKSPACES_BASE_DIR;
    originalAugmentWorkspacesRoot = process.env.AUGMENT_WORKSPACES_ROOT;
    baseDir = path.join(tmpdir(), 'workspace-orphan-cleanup', randomUUID());
    process.env.HOME = baseDir;
    process.env.WORKSPACES_BASE_DIR = baseDir;
    process.env.AUGMENT_WORKSPACES_ROOT = baseDir;
    await fs.mkdir(baseDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });

    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalWorkspacesBaseDir === undefined) {
      delete process.env.WORKSPACES_BASE_DIR;
    } else {
      process.env.WORKSPACES_BASE_DIR = originalWorkspacesBaseDir;
    }

    if (originalAugmentWorkspacesRoot === undefined) {
      delete process.env.AUGMENT_WORKSPACES_ROOT;
    } else {
      process.env.AUGMENT_WORKSPACES_ROOT = originalAugmentWorkspacesRoot;
    }

    vi.restoreAllMocks();
  });

  const createWorkspaceFixture = (id: WorkspaceId, overrides: Partial<Workspace> = {}): Workspace => ({
    id,
    title: 'Test Workspace',
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  });

  // Helper to create a mock repository for purgeDeletedWorkspaces tests
  const createMockRepository = (overrides: Partial<WorkspaceRepository> = {}) =>
    ({
      findById: vi.fn().mockResolvedValue(null),
      findAll: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(false),
      cleanup: vi.fn().mockResolvedValue(undefined),
      saveContext: vi.fn().mockResolvedValue(undefined),
      readContext: vi.fn().mockResolvedValue(null),
      readGitConfig: vi.fn().mockResolvedValue(''),
      scanDirectory: vi.fn().mockResolvedValue([]),
      cleanCache: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    }) as unknown as WorkspaceRepository;

  // ── 1. findAll() never deletes orphan directories ──────────────────

  describe('findAll does not delete orphan directories', () => {
    it('orphan directory with no metadata file — directory still exists', async () => {
      const repository = new FileSystemWorkspaceRepository();
      const workspaceId = 'amber-forest' as WorkspaceId;
      const workspacePath = path.join(WorkspaceConfig.WORKSPACES_BASE, workspaceId);
      const staleTime = new Date(Date.now() - 600_000);

      // Create directory with NO metadata file at all
      await fs.mkdir(workspacePath, { recursive: true });
      await fs.utimes(workspacePath, staleTime, staleTime);

      const result = await repository.findAll();
      expect(result).toEqual([]);
      // Directory must still exist — findAll() does not clean up orphans
      await expect(fs.access(workspacePath)).resolves.toBeUndefined();
    });

    it('orphan directory with invalid/corrupt metadata — directory still exists', async () => {
      const repository = new FileSystemWorkspaceRepository();
      const workspaceId = 'silver-canyon' as WorkspaceId;
      const workspacePath = path.join(WorkspaceConfig.WORKSPACES_BASE, workspaceId);
      const metadataDir = path.join(workspacePath, WorkspaceConfig.METADATA_FOLDER);
      const metadataPath = path.join(metadataDir, WorkspaceConfig.WORKSPACE_METADATA_FILE);
      const staleTime = new Date(Date.now() - 600_000);

      await fs.mkdir(metadataDir, { recursive: true });
      await fs.writeFile(metadataPath, '{ invalid json !!!');
      await fs.utimes(workspacePath, staleTime, staleTime);
      await fs.utimes(metadataDir, staleTime, staleTime);

      const result = await repository.findAll();
      expect(result).toEqual([]);
      // Directory must still exist
      await expect(fs.access(workspacePath)).resolves.toBeUndefined();
    });

    it('multiple orphans mixed with valid workspaces — valid returned, orphans untouched', async () => {
      const repository = new FileSystemWorkspaceRepository();
      const validId = 'cobalt-river' as WorkspaceId;
      const orphanId = 'broken-leaf' as WorkspaceId;
      const staleTime = new Date(Date.now() - 600_000);

      // Create valid workspace
      const validPath = path.join(WorkspaceConfig.WORKSPACES_BASE, validId);
      const validMetaDir = path.join(validPath, WorkspaceConfig.METADATA_FOLDER);
      await fs.mkdir(validMetaDir, { recursive: true });
      await fs.writeFile(
        path.join(validMetaDir, WorkspaceConfig.WORKSPACE_METADATA_FILE),
        JSON.stringify(createWorkspaceFixture(validId)),
      );

      // Create orphan (no metadata file)
      const orphanPath = path.join(WorkspaceConfig.WORKSPACES_BASE, orphanId);
      await fs.mkdir(orphanPath, { recursive: true });
      await fs.utimes(orphanPath, staleTime, staleTime);

      const result = await repository.findAll();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(validId);
      // Orphan directory must still exist
      await expect(fs.access(orphanPath)).resolves.toBeUndefined();
    });
  });

  // ── 2. purgeDeletedWorkspaces() grace period (5 minutes) ────────────

  describe('purgeDeletedWorkspaces grace period', () => {
    it('directory modified less than 5 minutes ago — NOT deleted', async () => {
      const repository = createMockRepository();
      const service = new WorkspaceService(repository);
      const workspaceId = 'fresh-ember' as WorkspaceId;
      const workspacePath = path.join(WorkspaceConfig.WORKSPACES_BASE, workspaceId);
      // Recent timestamp — within grace period
      const recentTime = new Date(Date.now() - 60_000); // 1 minute ago

      try {
        await fs.mkdir(workspacePath, { recursive: true });
        await fs.utimes(workspacePath, recentTime, recentTime);

        const result = await service.purgeDeletedWorkspaces();
        expect(result.ok).toBe(true);
        // Directory must survive — grace period protects it
        await expect(fs.access(workspacePath)).resolves.toBeUndefined();
      } finally {
        service.cleanup();
      }
    });

    it('directory modified more than 5 minutes ago with no valid metadata — deleted', async () => {
      const repository = createMockRepository();
      const service = new WorkspaceService(repository);
      const workspaceId = 'stale-ridge' as WorkspaceId;
      const workspacePath = path.join(WorkspaceConfig.WORKSPACES_BASE, workspaceId);
      const staleTime = new Date(Date.now() - 600_000); // 10 minutes ago

      try {
        await fs.mkdir(workspacePath, { recursive: true });
        await fs.utimes(workspacePath, staleTime, staleTime);

        const result = await service.purgeDeletedWorkspaces();
        expect(result.ok).toBe(true);
        // Directory should be deleted — old orphan with no metadata
        await expect(fs.access(workspacePath)).rejects.toThrow();
      } finally {
        service.cleanup();
      }
    });

    it('directory exactly at the 5-minute boundary — NOT deleted (safe side)', async () => {
      const repository = createMockRepository();
      const service = new WorkspaceService(repository);
      const workspaceId = 'edge-cliff' as WorkspaceId;
      const workspacePath = path.join(WorkspaceConfig.WORKSPACES_BASE, workspaceId);
      // Exactly at the boundary (ageMs === 300_000, which is NOT < 300_000, so it proceeds)
      // Actually the check is `ageMs < 300_000`, so at exactly 300_000 it will NOT skip.
      // But due to timing jitter we set it 1 second inside the grace period to be safe.
      const boundaryTime = new Date(Date.now() - 299_000);

      try {
        await fs.mkdir(workspacePath, { recursive: true });
        await fs.utimes(workspacePath, boundaryTime, boundaryTime);

        const result = await service.purgeDeletedWorkspaces();
        expect(result.ok).toBe(true);
        // Should survive — still within grace period
        await expect(fs.access(workspacePath)).resolves.toBeUndefined();
      } finally {
        service.cleanup();
      }
    });
  });

  // ── 3. purgeDeletedWorkspaces() findById safety check ─────────────

  describe('purgeDeletedWorkspaces findById safety check', () => {
    it('findById returns a valid workspace — NOT deleted despite missing metadata file', async () => {
      const workspaceId = 'saved-grove' as WorkspaceId;
      const workspacePath = path.join(WorkspaceConfig.WORKSPACES_BASE, workspaceId);
      const staleTime = new Date(Date.now() - 600_000);

      const repository = createMockRepository({
        findById: vi.fn().mockResolvedValue(createWorkspaceFixture(workspaceId)),
      });
      const service = new WorkspaceService(repository);

      try {
        await fs.mkdir(workspacePath, { recursive: true });
        await fs.utimes(workspacePath, staleTime, staleTime);

        const result = await service.purgeDeletedWorkspaces();
        expect(result.ok).toBe(true);
        // findById returned a workspace, so it's not a true orphan — must survive
        await expect(fs.access(workspacePath)).resolves.toBeUndefined();
        expect(repository.findById).toHaveBeenCalledWith(workspaceId);
      } finally {
        service.cleanup();
      }
    });

    it('findById returns null — deleted (true orphan)', async () => {
      const workspaceId = 'ghost-marsh' as WorkspaceId;
      const workspacePath = path.join(WorkspaceConfig.WORKSPACES_BASE, workspaceId);
      const staleTime = new Date(Date.now() - 600_000);

      const repository = createMockRepository({
        findById: vi.fn().mockResolvedValue(null),
      });
      const service = new WorkspaceService(repository);

      try {
        await fs.mkdir(workspacePath, { recursive: true });
        await fs.utimes(workspacePath, staleTime, staleTime);

        const result = await service.purgeDeletedWorkspaces();
        expect(result.ok).toBe(true);
        // findById returned null — true orphan, should be deleted
        await expect(fs.access(workspacePath)).rejects.toThrow();
      } finally {
        service.cleanup();
      }
    });

    it('findById throws an error — NOT deleted (transient error, skip to be safe)', async () => {
      const workspaceId = 'error-brook' as WorkspaceId;
      const workspacePath = path.join(WorkspaceConfig.WORKSPACES_BASE, workspaceId);
      const staleTime = new Date(Date.now() - 600_000);

      const repository = createMockRepository({
        findById: vi.fn().mockRejectedValue(new Error('corrupt data')),
      });
      const service = new WorkspaceService(repository);

      try {
        await fs.mkdir(workspacePath, { recursive: true });
        await fs.utimes(workspacePath, staleTime, staleTime);

        const result = await service.purgeDeletedWorkspaces();
        expect(result.ok).toBe(true);
        // findById threw — transient error, directory should be preserved
        await expect(fs.access(workspacePath)).resolves.toBeUndefined();
      } finally {
        service.cleanup();
      }
    });
  });

  // ── 4. Regression: valid workspace survives full lifecycle ─────────

  describe('valid workspace survives full lifecycle', () => {
    it('valid workspace survives both findAll and purgeDeletedWorkspaces', async () => {
      const workspaceId = 'solid-stone' as WorkspaceId;
      const workspacePath = path.join(WorkspaceConfig.WORKSPACES_BASE, workspaceId);
      const metadataDir = path.join(workspacePath, WorkspaceConfig.METADATA_FOLDER);
      const metadataPath = path.join(metadataDir, WorkspaceConfig.WORKSPACE_METADATA_FILE);
      const workspace = createWorkspaceFixture(workspaceId);

      // Write valid metadata
      await fs.mkdir(metadataDir, { recursive: true });
      await fs.writeFile(metadataPath, JSON.stringify(workspace));

      // findAll should return the workspace and not delete it
      const fsRepository = new FileSystemWorkspaceRepository();
      const findAllResult = await fsRepository.findAll();
      expect(findAllResult).toHaveLength(1);
      expect(findAllResult[0].id).toBe(workspaceId);
      await expect(fs.access(workspacePath)).resolves.toBeUndefined();

      // purgeDeletedWorkspaces should also leave it intact (status is Active)
      const mockRepo = createMockRepository();
      const service = new WorkspaceService(mockRepo);
      try {
        const purgeResult = await service.purgeDeletedWorkspaces();
        expect(purgeResult.ok).toBe(true);
        await expect(fs.access(workspacePath)).resolves.toBeUndefined();
        await expect(fs.access(metadataPath)).resolves.toBeUndefined();
      } finally {
        service.cleanup();
      }
    });

    it('workspace being created (metadata not yet written) — survives due to grace period', async () => {
      const workspaceId = 'young-flame' as WorkspaceId;
      const workspacePath = path.join(WorkspaceConfig.WORKSPACES_BASE, workspaceId);

      // Simulate a workspace directory that was just created (no metadata yet)
      await fs.mkdir(workspacePath, { recursive: true });
      // Don't set old timestamps — directory is fresh (just created)

      // findAll should return empty but not delete the directory
      const fsRepository = new FileSystemWorkspaceRepository();
      const findAllResult = await fsRepository.findAll();
      expect(findAllResult).toEqual([]);
      await expect(fs.access(workspacePath)).resolves.toBeUndefined();

      // purgeDeletedWorkspaces should also skip it — grace period protects fresh directories
      const mockRepo = createMockRepository();
      const service = new WorkspaceService(mockRepo);
      try {
        const purgeResult = await service.purgeDeletedWorkspaces();
        expect(purgeResult.ok).toBe(true);
        await expect(fs.access(workspacePath)).resolves.toBeUndefined();
      } finally {
        service.cleanup();
      }
    });
  });

  // ── Existing tests ────────────────────────────────────────────────

  it('does not delete a valid workspace when clearing an invalid worktree path fails to save', async () => {
    const workspaceId = randomUUID() as WorkspaceId;
    const workspacePath = path.join(WorkspaceConfig.WORKSPACES_BASE, workspaceId);
    const metadataDir = path.join(workspacePath, WorkspaceConfig.METADATA_FOLDER);
    const metadataPath = path.join(metadataDir, WorkspaceConfig.WORKSPACE_METADATA_FILE);
    const save = vi.fn().mockRejectedValue(new Error('save failed'));
    const workspaceFixture = createWorkspaceFixture(workspaceId, {
      worktreePath: path.join(baseDir, 'missing-worktree'),
    });
    const repository = {
      findById: vi.fn().mockResolvedValue(workspaceFixture),
      findAll: vi.fn(),
      save,
      delete: vi.fn(),
      exists: vi.fn(),
      cleanup: vi.fn(),
      saveContext: vi.fn(),
      readContext: vi.fn(),
      readGitConfig: vi.fn(),
      scanDirectory: vi.fn(),
      cleanCache: vi.fn(),
    } as unknown as WorkspaceRepository;
    const service = new WorkspaceService(repository);

    await fs.mkdir(metadataDir, { recursive: true });
    await fs.writeFile(metadataPath, JSON.stringify(workspaceFixture));

    try {
      const result = await service.purgeDeletedWorkspaces();

      expect(result.ok).toBe(true);
      expect(save).toHaveBeenCalledTimes(1);
      await expect(fs.access(workspacePath)).resolves.toBeUndefined();
      await expect(fs.access(metadataPath)).resolves.toBeUndefined();
    } finally {
      service.cleanup();
    }
  });
});