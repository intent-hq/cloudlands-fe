import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { WorkspaceId } from '../../../../shared/types';

/**
 * Round-trip tests for the panel-layout history repository
 * (features/layout/main/panel-layout-history.repository.ts).
 *
 * History lives under `<userData>/workspace-state/<backendKey>/<workspaceId>/
 * panel-layout-history.json` — keyed by backend id + workspace id, never a
 * guessed workspace checkout dir (intent-hq/monorepo#1760). A temp dir stands
 * in for userData so persistence across "restarts" (fresh repository
 * instances) is exercised for real.
 */

let tmpDir: string;

const wsId = 'amber-forest-a7x2' as WorkspaceId;

function makeData(historyLength = 1) {
  return {
    version: 1,
    workspaceId: wsId as string,
    history: Array.from({ length: historyLength }, (_, i) => ({
      root: { type: 'leaf' },
      panels: {},
      focusedPanelId: null,
      timestamp: i,
    })),
    historyIndex: historyLength - 1,
    lastUpdated: new Date().toISOString(),
  };
}

async function loadRepositoryModule() {
  return await import('../panel-layout-history.repository');
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'panel-layout-history-'));
  vi.resetModules();
  vi.doMock('electron', () => ({
    app: { getPath: () => tmpDir },
  }));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.doUnmock('electron');
});

describe('FileSystemPanelLayoutHistoryRepository', () => {
  it('round-trips history through userData and survives a restart', async () => {
    const mod = await loadRepositoryModule();
    const data = makeData(2);
    await new mod.FileSystemPanelLayoutHistoryRepository().save(wsId, data);

    // A fresh instance (≈ app restart) reads the same state back.
    const reloaded = await new mod.FileSystemPanelLayoutHistoryRepository().load(wsId);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.history).toHaveLength(2);
    expect(reloaded!.historyIndex).toBe(1);
    expect(reloaded!.workspaceId).toBe(wsId);
  });

  it('writes under workspace-state/local/<workspaceId> when no backend id is given', async () => {
    const mod = await loadRepositoryModule();
    await new mod.FileSystemPanelLayoutHistoryRepository().save(wsId, makeData());

    const expected = path.join(
      tmpDir,
      'workspace-state',
      'local',
      wsId,
      'panel-layout-history.json',
    );
    await expect(fs.access(expected)).resolves.toBeUndefined();
  });

  it('isolates histories per backend id (directory key, sanitized)', async () => {
    const mod = await loadRepositoryModule();
    const repo = new mod.FileSystemPanelLayoutHistoryRepository();
    const localData = makeData(1);
    const remoteData = makeData(3);
    await repo.save(wsId, localData, 'local');
    await repo.save(wsId, remoteData, '10.0.0.9:5181');

    const local = await repo.load(wsId, 'local');
    const remote = await repo.load(wsId, '10.0.0.9:5181');
    expect(local!.history).toHaveLength(1);
    expect(remote!.history).toHaveLength(3);

    // Host:port punctuation must collapse to a filesystem-safe directory key.
    const remotePath = path.join(
      tmpDir,
      'workspace-state',
      '10.0.0.9_5181',
      wsId,
      'panel-layout-history.json',
    );
    await expect(fs.access(remotePath)).resolves.toBeUndefined();
  });

  it('neutralizes all-dot backend ids instead of escaping the state root', async () => {
    const mod = await loadRepositoryModule();
    const repo = new mod.FileSystemPanelLayoutHistoryRepository();
    await repo.save(wsId, makeData(), '..');

    // '..' must not resolve one level above workspace-state/.
    await expect(fs.access(path.join(tmpDir, wsId, 'panel-layout-history.json'))).rejects.toThrow();
    const contained = path.join(tmpDir, 'workspace-state', '__', wsId, 'panel-layout-history.json');
    await expect(fs.access(contained)).resolves.toBeUndefined();
    expect((await repo.load(wsId, '..'))!.history).toHaveLength(1);
  });

  it('returns null when no history has been saved', async () => {
    const mod = await loadRepositoryModule();
    const repo = new mod.FileSystemPanelLayoutHistoryRepository();
    expect(await repo.load(wsId)).toBeNull();
  });

  it('returns null on a workspace id mismatch inside the file', async () => {
    const mod = await loadRepositoryModule();
    const repo = new mod.FileSystemPanelLayoutHistoryRepository();
    await repo.save(wsId, makeData());
    expect(await repo.load('other-forest-b1c2' as WorkspaceId)).toBeNull();
  });

  it('caps persisted history at 50 snapshots and adjusts the index', async () => {
    const mod = await loadRepositoryModule();
    const repo = new mod.FileSystemPanelLayoutHistoryRepository();
    const data = makeData(60);
    data.historyIndex = 59;
    await repo.save(wsId, data);

    const reloaded = await repo.load(wsId);
    expect(reloaded!.history).toHaveLength(50);
    expect(reloaded!.historyIndex).toBe(49);
  });
});

describe('InMemoryPanelLayoutHistoryRepository', () => {
  it('keys entries by backend id + workspace id', async () => {
    const mod = await loadRepositoryModule();
    const repo = new mod.InMemoryPanelLayoutHistoryRepository();
    await repo.save(wsId, makeData(1));
    await repo.save(wsId, makeData(2), 'remote-abc');

    expect((await repo.load(wsId))!.history).toHaveLength(1);
    expect((await repo.load(wsId, 'local'))!.history).toHaveLength(1);
    expect((await repo.load(wsId, 'remote-abc'))!.history).toHaveLength(2);
  });
});
