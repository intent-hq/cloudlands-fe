import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { WorkspaceId } from '../../../../shared/types';

/**
 * Round-trip tests for the first-visit state repository
 * (features/workspace/main/first-visit-state.repository.ts).
 *
 * State lives under `<userData>/workspace-state/<backendKey>/<workspaceId>/
 * first-visit-state.json` — keyed by backend id + workspace id, never a
 * guessed workspace checkout dir (intent-hq/monorepo#1760). A temp dir stands
 * in for userData so persistence across "restarts" (fresh repository
 * instances) is exercised for real.
 */

let tmpDir: string;

const wsId = 'amber-forest-a7x2' as WorkspaceId;

async function loadRepositoryModule() {
  return await import('../first-visit-state.repository');
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'first-visit-state-'));
  vi.resetModules();
  vi.doMock('electron', () => ({
    app: { getPath: () => tmpDir },
  }));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.doUnmock('electron');
});

describe('FileSystemFirstVisitStateRepository', () => {
  it('round-trips state through userData and survives a restart', async () => {
    const mod = await loadRepositoryModule();
    const state = mod.createDefaultFirstVisitState(wsId);
    state.mainContentRevealed = true;
    await new mod.FileSystemFirstVisitStateRepository().save(wsId, state);

    // A fresh instance (≈ app restart) reads the same state back.
    const reloaded = await new mod.FileSystemFirstVisitStateRepository().load(wsId);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.workspaceId).toBe(wsId);
    expect(reloaded!.mainContentRevealed).toBe(true);
  });

  it('writes under workspace-state/local/<workspaceId> when no backend id is given', async () => {
    const mod = await loadRepositoryModule();
    const repo = new mod.FileSystemFirstVisitStateRepository();
    await repo.save(wsId, mod.createDefaultFirstVisitState(wsId));

    const expected = path.join(tmpDir, 'workspace-state', 'local', wsId, 'first-visit-state.json');
    await expect(fs.access(expected)).resolves.toBeUndefined();
  });

  it('isolates state per backend id (directory key, sanitized)', async () => {
    const mod = await loadRepositoryModule();
    const repo = new mod.FileSystemFirstVisitStateRepository();
    const localState = mod.createDefaultFirstVisitState(wsId);
    const remoteState = { ...mod.createDefaultFirstVisitState(wsId), mainContentRevealed: true };
    await repo.save(wsId, localState);
    await repo.save(wsId, remoteState, '10.0.0.9:5181');

    expect((await repo.load(wsId))!.mainContentRevealed).toBe(false);
    expect((await repo.load(wsId, '10.0.0.9:5181'))!.mainContentRevealed).toBe(true);

    // Host:port punctuation must collapse to a filesystem-safe directory key.
    const remotePath = path.join(
      tmpDir,
      'workspace-state',
      '10.0.0.9_5181',
      wsId,
      'first-visit-state.json',
    );
    await expect(fs.access(remotePath)).resolves.toBeUndefined();
  });

  it('exists/delete operate on the backend-keyed file', async () => {
    const mod = await loadRepositoryModule();
    const repo = new mod.FileSystemFirstVisitStateRepository();
    await repo.save(wsId, mod.createDefaultFirstVisitState(wsId), 'remote-abc');

    expect(await repo.exists(wsId, 'remote-abc')).toBe(true);
    expect(await repo.exists(wsId)).toBe(false);

    await repo.delete(wsId, 'remote-abc');
    expect(await repo.exists(wsId, 'remote-abc')).toBe(false);
    expect(await repo.load(wsId, 'remote-abc')).toBeNull();

    // Deleting a missing file is a no-op, not an error.
    await expect(repo.delete(wsId)).resolves.toBeUndefined();
  });

  it('neutralizes all-dot backend ids instead of escaping the state root', async () => {
    const mod = await loadRepositoryModule();
    const repo = new mod.FileSystemFirstVisitStateRepository();
    await repo.save(wsId, mod.createDefaultFirstVisitState(wsId), '..');

    // '..' must not resolve one level above workspace-state/.
    await expect(fs.access(path.join(tmpDir, wsId, 'first-visit-state.json'))).rejects.toThrow();
    const contained = path.join(tmpDir, 'workspace-state', '__', wsId, 'first-visit-state.json');
    await expect(fs.access(contained)).resolves.toBeUndefined();
    expect(await repo.exists(wsId, '..')).toBe(true);
  });

  it('returns null when no state has been saved', async () => {
    const mod = await loadRepositoryModule();
    expect(await new mod.FileSystemFirstVisitStateRepository().load(wsId)).toBeNull();
  });

  it('returns null on a workspace id mismatch inside the file', async () => {
    const mod = await loadRepositoryModule();
    const repo = new mod.FileSystemFirstVisitStateRepository();
    const state = mod.createDefaultFirstVisitState(wsId);
    await repo.save(wsId, state);

    // Overwrite the persisted workspaceId to simulate a stale/foreign file.
    const filePath = path.join(tmpDir, 'workspace-state', 'local', wsId, 'first-visit-state.json');
    const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    raw.workspaceId = 'other-forest-b1c2';
    await fs.writeFile(filePath, JSON.stringify(raw), 'utf-8');

    expect(await repo.load(wsId)).toBeNull();
  });
});

describe('InMemoryFirstVisitStateRepository', () => {
  it('keys entries by backend id + workspace id', async () => {
    const mod = await loadRepositoryModule();
    const repo = new mod.InMemoryFirstVisitStateRepository();
    await repo.save(wsId, mod.createDefaultFirstVisitState(wsId));
    await repo.save(
      wsId,
      { ...mod.createDefaultFirstVisitState(wsId), mainContentRevealed: true },
      'remote-abc',
    );

    expect((await repo.load(wsId))!.mainContentRevealed).toBe(false);
    expect((await repo.load(wsId, 'local'))!.mainContentRevealed).toBe(false);
    expect((await repo.load(wsId, 'remote-abc'))!.mainContentRevealed).toBe(true);
    expect(await repo.exists(wsId, 'remote-abc')).toBe(true);
    await repo.delete(wsId, 'remote-abc');
    expect(await repo.exists(wsId, 'remote-abc')).toBe(false);
  });
});
