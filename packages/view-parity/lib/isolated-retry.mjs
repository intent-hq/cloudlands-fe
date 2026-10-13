import assert from 'node:assert/strict';
import { chmod, lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export async function isolatedRetryFixture() {
  const filename = process.env.RETRY_FIXTURE_MANIFEST;
  assert(filename, 'Set RETRY_FIXTURE_MANIFEST to the disposable daemon fixture manifest');
  const fixture = JSON.parse(await readFile(filename, 'utf8'));
  assert.equal(fixture.disposable, true);
  const ownedRoot = await realpath(fixture.ownedRoot);
  assert(
    ownedRoot.startsWith('/tmp/intent-retry-'),
    'Only an owned temporary retry fixture is allowed',
  );
  const contained = async (filename) => {
    const resolved = await realpath(filename);
    assert(resolved.startsWith(`${ownedRoot}${path.sep}`), 'Fixture path escaped its owned root');
    assert.equal((await lstat(filename)).isSymbolicLink(), false);
    return resolved;
  };
  const socket = await contained(fixture.socket);
  assert((await lstat(socket)).isSocket());
  const base = process.env.REACT_BASE_URL;
  assert(base, 'Set REACT_BASE_URL to the isolated frontend');
  const health = await fetch(`${base}/__sandbox/health`).then((response) => response.json());
  assert.equal(health.daemon.socket, fixture.bridgeSocket);
  assert.equal(health.daemon.reachable, true);
  assert.equal(process.env.REACT_WORKSPACE_ID, fixture.workspaceId);
  assert.equal(process.env.REACT_NOTE_ID, fixture.noteId);
  return {
    ...fixture,
    base,
    async failFile() {
      const file = await contained(path.join(fixture.repositoryRoot, fixture.fileRelativePath));
      const original = (await lstat(file)).mode & 0o777;
      await chmod(file, 0);
      return () => chmod(file, original);
    },
    async failGit() {
      const file = await contained(path.join(fixture.repositoryRoot, '.git/index'));
      const original = (await lstat(file)).mode & 0o777;
      await chmod(file, 0);
      return () => chmod(file, original);
    },
    async failNote() {
      const database = await contained(fixture.database);
      const db = new DatabaseSync(database);
      try {
        const params = [fixture.workspaceId, fixture.noteId];
        const original = db
          .prepare('SELECT created_at FROM note WHERE workspace_id=? AND id=?')
          .get(...params);
        assert.equal(typeof original?.created_at, 'string');
        const changed = db
          .prepare('UPDATE note SET created_at=? WHERE workspace_id=? AND id=?')
          .run(Buffer.from('isolated storage type failure'), ...params);
        assert.equal(changed.changes, 1);
        return () => {
          const restore = new DatabaseSync(database);
          try {
            assert.equal(
              restore
                .prepare('UPDATE note SET created_at=? WHERE workspace_id=? AND id=?')
                .run(original.created_at, ...params).changes,
              1,
            );
          } finally {
            restore.close();
          }
        };
      } finally {
        db.close();
      }
    },
  };
}

export function observeDaemonWire(page) {
  const requests = [];
  const replies = [];
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/intentd/ws') return;
    const pending = new Map();
    socket.on('framesent', ({ payload }) => {
      const request = JSON.parse(String(payload));
      requests.push(request);
      if (request.id !== undefined) pending.set(request.id, request);
    });
    socket.on('framereceived', ({ payload }) => {
      const response = JSON.parse(String(payload));
      const request = pending.get(response.id);
      pending.delete(response.id);
      if (request) replies.push({ request, response });
    });
  });
  return { requests, replies };
}
