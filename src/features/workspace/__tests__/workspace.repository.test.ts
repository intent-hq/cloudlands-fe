/**
 * Tests for Workspace Repository
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import {
  FileSystemWorkspaceRepository,
  getChiefWorkspace,
  InMemoryWorkspaceRepository,
} from '../main/workspace.repository';
import type { Workspace } from '../../../shared/types';
import { WorkspaceStatus } from '../../../shared/types';
import { CHIEF_WORKSPACE_ID } from '../../../shared/types/branded-ids';
import { WorkspaceConfig } from '../../../shared/main/config';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { randomUUID } from 'crypto';

describe('InMemoryWorkspaceRepository', () => {
  let repository: InMemoryWorkspaceRepository;

  beforeEach(() => {
    repository = new InMemoryWorkspaceRepository();
  });

  // Helper function to create test workspace
  const createTestWorkspace = (overrides?: Partial<Workspace>): Workspace => ({
    id: randomUUID(),
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

  describe('save and findById', () => {
    it('should return the synthetic chief workspace by fixed id', async () => {
      const chiefWorkspace = await repository.findById(CHIEF_WORKSPACE_ID);

      expect(chiefWorkspace).toEqual(getChiefWorkspace());
      expect(chiefWorkspace?.title).toBe('Chief of Staff');
      expect(chiefWorkspace?.repositoryPath).toBeUndefined();
      expect(chiefWorkspace?.worktreePath).toBeUndefined();
    });

    it('should save and retrieve a workspace', async () => {
      const workspace = createTestWorkspace();

      await repository.save(workspace);
      const retrieved = await repository.findById(workspace.id);

      expect(retrieved).toEqual(workspace);
    });

    it('should return null for non-existent workspace', async () => {
      const result = await repository.findById(randomUUID());
      expect(result).toBeNull();
    });

    it('should update existing workspace', async () => {
      const workspace = createTestWorkspace({ title: 'Original Title' });

      await repository.save(workspace);

      const updated = { ...workspace, title: 'Updated Title' };
      await repository.save(updated);

      const retrieved = await repository.findById(workspace.id);
      expect(retrieved?.title).toBe('Updated Title');
    });
  });

  describe('findAll', () => {
    it('should not include the synthetic chief workspace in workspace scans', async () => {
      const workspaces = await repository.findAll();
      expect(workspaces.map((w) => w.id)).not.toContain(CHIEF_WORKSPACE_ID);
    });

    it('should return empty array when no workspaces', async () => {
      const workspaces = await repository.findAll();
      expect(workspaces).toEqual([]);
    });

    it('should return all workspaces', async () => {
      const workspace1 = createTestWorkspace({ title: 'Workspace 1' });
      const workspace2 = createTestWorkspace({ title: 'Workspace 2' });

      await repository.save(workspace1);
      await repository.save(workspace2);

      const workspaces = await repository.findAll();
      expect(workspaces).toHaveLength(2);
      expect(workspaces.map((w) => w.id)).toContain(workspace1.id);
      expect(workspaces.map((w) => w.id)).toContain(workspace2.id);
    });
  });

  describe('delete', () => {
    it('should delete a workspace', async () => {
      const workspace = createTestWorkspace();

      await repository.save(workspace);
      await repository.delete(workspace.id);

      const retrieved = await repository.findById(workspace.id);
      expect(retrieved).toBeNull();
    });

    it('should throw when deleting non-existent workspace', async () => {
      await expect(repository.delete(randomUUID())).rejects.toThrow('not found');
    });
  });

  describe('exists', () => {
    it('should return true for the synthetic chief workspace', async () => {
      await expect(repository.exists(CHIEF_WORKSPACE_ID)).resolves.toBe(true);
    });

    it('should return true for existing workspace', async () => {
      const workspace = createTestWorkspace();

      await repository.save(workspace);
      const exists = await repository.exists(workspace.id);
      expect(exists).toBe(true);
    });

    it('should return false for non-existent workspace', async () => {
      const exists = await repository.exists(randomUUID());
      expect(exists).toBe(false);
    });
  });

  describe('count', () => {
    it('should return 0 when no workspaces', () => {
      expect(repository.count()).toBe(0);
    });

    it('should return correct count', async () => {
      const workspace1 = createTestWorkspace({ title: 'Workspace 1' });
      const workspace2 = createTestWorkspace({ title: 'Workspace 2' });

      await repository.save(workspace1);
      expect(repository.count()).toBe(1);

      await repository.save(workspace2);
      expect(repository.count()).toBe(2);

      await repository.delete(workspace1.id);
      expect(repository.count()).toBe(1);
    });
  });

  describe('clear', () => {
    it('should remove all workspaces', async () => {
      const workspace1 = createTestWorkspace({ title: 'Workspace 1' });
      const workspace2 = createTestWorkspace({ title: 'Workspace 2' });

      await repository.save(workspace1);
      await repository.save(workspace2);

      repository.clear();

      expect(repository.count()).toBe(0);
      const workspaces = await repository.findAll();
      expect(workspaces).toEqual([]);
    });
  });
});

describe('FileSystemWorkspaceRepository disk JSON freshness', () => {
  let repository: FileSystemWorkspaceRepository;
  let tempRoot: string;
  let originalWorkspacesBaseDir: string | undefined;

  const createFileSystemWorkspace = (overrides?: Partial<Workspace>): Workspace => ({
    id: randomUUID(),
    title: 'Disk Workspace',
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  });

  beforeEach(async () => {
    originalWorkspacesBaseDir = process.env.WORKSPACES_BASE_DIR;
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'intent-workspace-repository-'));
    process.env.WORKSPACES_BASE_DIR = tempRoot;
    repository = new FileSystemWorkspaceRepository();
  });

  afterEach(async () => {
    if (originalWorkspacesBaseDir === undefined) {
      delete process.env.WORKSPACES_BASE_DIR;
    } else {
      process.env.WORKSPACES_BASE_DIR = originalWorkspacesBaseDir;
    }

    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('findById reads current workspace JSON from disk on repeated calls', async () => {
    const workspace = createFileSystemWorkspace({ title: 'Original Title' });

    await repository.save(workspace);
    await expect(repository.findById(workspace.id)).resolves.toMatchObject({
      title: 'Original Title',
    });

    const externallyUpdatedWorkspace = {
      ...workspace,
      title: 'Externally Updated Title',
      updatedAt: new Date(Date.now() + 1000).toISOString(),
    };
    await fs.writeFile(
      WorkspaceConfig.paths.workspaceMetadata(workspace.id),
      JSON.stringify(externallyUpdatedWorkspace, null, 2),
      'utf-8',
    );

    await expect(repository.findById(workspace.id)).resolves.toMatchObject({
      title: 'Externally Updated Title',
    });
  });

  it('findAll returns workspace objects parsed from current workspace JSON files', async () => {
    const workspace = createFileSystemWorkspace({ title: 'List Original Title' });

    await repository.save(workspace);
    expect((await repository.findAll()).find((w) => w.id === workspace.id)?.title).toBe(
      'List Original Title',
    );

    const externallyUpdatedWorkspace = {
      ...workspace,
      title: 'List Externally Updated Title',
      updatedAt: new Date(Date.now() + 1000).toISOString(),
    };
    await fs.writeFile(
      WorkspaceConfig.paths.workspaceMetadata(workspace.id),
      JSON.stringify(externallyUpdatedWorkspace, null, 2),
      'utf-8',
    );

    expect((await repository.findAll()).find((w) => w.id === workspace.id)?.title).toBe(
      'List Externally Updated Title',
    );
  });
});

describe('FileSystemWorkspaceRepository virtual workspaces', () => {
  it('should resolve chief workspace without reading workspace metadata from disk', async () => {
    const repository = new FileSystemWorkspaceRepository();
    const accessSpy = vi.spyOn(fs, 'access');

    const chiefWorkspace = await repository.findById(CHIEF_WORKSPACE_ID);

    expect(chiefWorkspace).toEqual(getChiefWorkspace());
    expect(accessSpy).not.toHaveBeenCalled();
    accessSpy.mockRestore();
  });

  it('should not create directories when asked to save chief workspace', async () => {
    const repository = new FileSystemWorkspaceRepository();
    const mkdirSpy = vi.spyOn(fs, 'mkdir');

    await repository.save(getChiefWorkspace());

    expect(mkdirSpy).not.toHaveBeenCalled();
    mkdirSpy.mockRestore();
  });
});
