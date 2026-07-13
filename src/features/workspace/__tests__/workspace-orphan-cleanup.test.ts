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

  // ── 2. purgeDeletedWorkspaces() is now daemon-owned ─────────────────
  //
  // The former FE-side purge tests (grace period, findById safety check,
  // full-lifecycle survives, invalid-worktree preservation) were retired
  // alongside the local implementation. `service.purgeDeletedWorkspaces()`
  // now delegates to the daemon `workspace.purge` RPC (PROTOCOL.md §5.1);
  // its wire contract is pinned in workspace-service-write-wire.test.ts.
});
