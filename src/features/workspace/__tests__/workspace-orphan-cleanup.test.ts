import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { FileSystemWorkspaceRepository } from '../main/workspace.repository';
import type { WorkspaceRepository } from '../main/workspace.repository';
import { WorkspaceService } from '../main/workspace.service';
import { InMemoryNotesRepository } from '../../notes/main/notes.repository';
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

  const waitForRemoval = async (targetPath: string): Promise<void> => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const exists = await fs.access(targetPath).then(() => true).catch(() => false);
      if (!exists) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error(`Timed out waiting for removal of ${targetPath}`);
  };

  it('does not delete a freshly created workspace directory while metadata is still being written', async () => {
    const repository = new FileSystemWorkspaceRepository();
    const workspaceId = randomUUID() as WorkspaceId;
    const workspacePath = path.join(WorkspaceConfig.WORKSPACES_BASE, workspaceId);
    const metadataDir = path.join(workspacePath, WorkspaceConfig.METADATA_FOLDER);

    await fs.mkdir(metadataDir, { recursive: true });

    await expect(repository.findAll()).resolves.toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(fs.access(workspacePath)).resolves.toBeUndefined();
  });

  it('cleans up stale orphan workspace directories discovered during findAll', async () => {
    const repository = new FileSystemWorkspaceRepository();
    const workspaceId = randomUUID() as WorkspaceId;
    const workspacePath = path.join(WorkspaceConfig.WORKSPACES_BASE, workspaceId);
    const metadataDir = path.join(workspacePath, WorkspaceConfig.METADATA_FOLDER);
    const staleTime = new Date(Date.now() - 60_000);

    await fs.mkdir(metadataDir, { recursive: true });
    await fs.utimes(workspacePath, staleTime, staleTime);
    await fs.utimes(metadataDir, staleTime, staleTime);

    await expect(repository.findAll()).resolves.toEqual([]);
    await waitForRemoval(workspacePath);
  });

  it('does not delete a valid workspace when clearing an invalid worktree path fails to save', async () => {
    const workspaceId = randomUUID() as WorkspaceId;
    const workspacePath = path.join(WorkspaceConfig.WORKSPACES_BASE, workspaceId);
    const metadataDir = path.join(workspacePath, WorkspaceConfig.METADATA_FOLDER);
    const metadataPath = path.join(metadataDir, WorkspaceConfig.WORKSPACE_METADATA_FILE);
    const save = vi.fn().mockRejectedValue(new Error('save failed'));
    const repository = {
      findById: vi.fn(),
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
      clearListCache: vi.fn(),
    } as unknown as WorkspaceRepository;
    const service = new WorkspaceService(repository, new InMemoryNotesRepository());

    await fs.mkdir(metadataDir, { recursive: true });
    await fs.writeFile(
      metadataPath,
      JSON.stringify(
        createWorkspaceFixture(workspaceId, {
          worktreePath: path.join(baseDir, 'missing-worktree'),
        }),
      ),
    );

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