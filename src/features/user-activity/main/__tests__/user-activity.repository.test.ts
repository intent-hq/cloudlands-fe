/**
 * User Activity Repository Tests
 *
 * TDD tests for the user activity file-based repository.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  FileSystemUserActivityRepository,
  InMemoryUserActivityRepository,
} from '../user-activity.repository';
import {
  createEmptyUserActivityData,
  LOCAL_USER_ID,
  USER_ACTIVITY_VERSION,
} from '$shared/types/user-activity.types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';

describe('InMemoryUserActivityRepository', () => {
  let repo: InMemoryUserActivityRepository;
  const workspaceId = WorkspaceId('test-workspace-123');
  const noteId = NoteId('test-note-456');

  beforeEach(() => {
    repo = new InMemoryUserActivityRepository();
  });

  it('should return null for non-existent workspace', async () => {
    const result = await repo.load(workspaceId);
    expect(result).toBeNull();
  });

  it('should save and load user activity data', async () => {
    const data = createEmptyUserActivityData();
    data.noteReads[noteId] = {
      lastReadAt: '2024-01-15T10:00:00.000Z',
      readCount: 1,
    };

    await repo.save(workspaceId, data);
    const loaded = await repo.load(workspaceId);

    expect(loaded).not.toBeNull();
    expect(loaded?.userId).toBe(LOCAL_USER_ID);
    expect(loaded?.noteReads[noteId]?.lastReadAt).toBe('2024-01-15T10:00:00.000Z');
  });

  it('should overwrite existing data on save', async () => {
    const data1 = createEmptyUserActivityData();
    data1.noteReads['note-1'] = { lastReadAt: '2024-01-01T00:00:00.000Z' };
    await repo.save(workspaceId, data1);

    const data2 = createEmptyUserActivityData();
    data2.noteReads['note-2'] = { lastReadAt: '2024-01-02T00:00:00.000Z' };
    await repo.save(workspaceId, data2);

    const loaded = await repo.load(workspaceId);
    expect(loaded?.noteReads['note-1']).toBeUndefined();
    expect(loaded?.noteReads['note-2']).toBeDefined();
  });
});

describe('FileSystemUserActivityRepository', () => {
  let repo: FileSystemUserActivityRepository;
  let testDir: string;
  const workspaceId = WorkspaceId('test-workspace-fs');
  const noteId = NoteId('test-note-fs');

  beforeEach(async () => {
    // Create temp directory for tests
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'user-activity-test-'));
    repo = new FileSystemUserActivityRepository(testDir);
  });

  afterEach(async () => {
    // Cleanup temp directory
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should return null for non-existent file', async () => {
    const result = await repo.load(workspaceId);
    expect(result).toBeNull();
  });

  it('should save and load user activity data', async () => {
    const data = createEmptyUserActivityData();
    data.noteReads[noteId] = {
      lastReadAt: '2024-01-15T10:00:00.000Z',
      readCount: 3,
    };

    await repo.save(workspaceId, data);
    const loaded = await repo.load(workspaceId);

    expect(loaded).not.toBeNull();
    expect(loaded?.version).toBe(USER_ACTIVITY_VERSION);
    expect(loaded?.noteReads[noteId]?.lastReadAt).toBe('2024-01-15T10:00:00.000Z');
    expect(loaded?.noteReads[noteId]?.readCount).toBe(3);
  });

  it('should create directory structure if it does not exist', async () => {
    const data = createEmptyUserActivityData();
    await repo.save(workspaceId, data);

    const metadataDir = path.join(testDir, workspaceId, '.workspace');
    const exists = await fs
      .access(metadataDir)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  it('should handle corrupted JSON gracefully', async () => {
    // Manually write corrupted JSON
    const metadataDir = path.join(testDir, workspaceId, '.workspace');
    await fs.mkdir(metadataDir, { recursive: true });
    await fs.writeFile(path.join(metadataDir, 'user-activity.json'), 'not valid json{{{');

    const result = await repo.load(workspaceId);
    expect(result).toBeNull();
  });

  it('should handle empty file gracefully', async () => {
    const metadataDir = path.join(testDir, workspaceId, '.workspace');
    await fs.mkdir(metadataDir, { recursive: true });
    await fs.writeFile(path.join(metadataDir, 'user-activity.json'), '');

    const result = await repo.load(workspaceId);
    expect(result).toBeNull();
  });

  it('should reject data with invalid schema version', async () => {
    // Write valid JSON but with wrong schema version
    const metadataDir = path.join(testDir, workspaceId, '.workspace');
    await fs.mkdir(metadataDir, { recursive: true });
    const invalidData = {
      version: 999, // Invalid version
      userId: LOCAL_USER_ID,
      noteReads: {},
      lastUpdated: new Date().toISOString(),
    };
    await fs.writeFile(path.join(metadataDir, 'user-activity.json'), JSON.stringify(invalidData));

    const result = await repo.load(workspaceId);
    expect(result).toBeNull();
  });

  it('should reject data with missing required fields', async () => {
    // Write valid JSON but missing required fields
    const metadataDir = path.join(testDir, workspaceId, '.workspace');
    await fs.mkdir(metadataDir, { recursive: true });
    const invalidData = {
      version: USER_ACTIVITY_VERSION,
      // Missing userId, noteReads, lastUpdated
    };
    await fs.writeFile(path.join(metadataDir, 'user-activity.json'), JSON.stringify(invalidData));

    const result = await repo.load(workspaceId);
    expect(result).toBeNull();
  });

  it('should reject data with invalid noteReads structure', async () => {
    // Write valid JSON but with invalid noteReads structure
    const metadataDir = path.join(testDir, workspaceId, '.workspace');
    await fs.mkdir(metadataDir, { recursive: true });
    const invalidData = {
      version: USER_ACTIVITY_VERSION,
      userId: LOCAL_USER_ID,
      noteReads: {
        'note-1': {
          // Missing lastReadAt
          readCount: 5,
        },
      },
      lastUpdated: new Date().toISOString(),
    };
    await fs.writeFile(path.join(metadataDir, 'user-activity.json'), JSON.stringify(invalidData));

    const result = await repo.load(workspaceId);
    expect(result).toBeNull();
  });
});
