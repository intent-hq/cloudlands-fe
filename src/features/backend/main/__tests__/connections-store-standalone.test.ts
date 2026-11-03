import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => {
  throw new Error('Standalone store must not load Electron');
});

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it('persists standalone tokens privately with an explicit plaintext marker', async () => {
  const { createConnectionsStore, plaintextTokenCodec } = await import('../connections-store');
  const dataDir = await mkdtemp(join(tmpdir(), 'standalone-connections-'));
  dirs.push(dataDir);
  const store = createConnectionsStore({ dataDir, tokenCodec: plaintextTokenCodec });
  const record = await store.add({
    label: 'Remote',
    host: '192.168.1.10',
    port: 8443,
    fingerprint: 'AA:BB:CC',
    token: 'private-token',
  });
  const filename = join(dataDir, 'backend-connections.json');
  expect((await stat(filename)).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(filename, 'utf8')).connections[0].encToken).toEqual({
    encrypted: false,
    value: 'private-token',
  });
  expect(JSON.stringify(await store.list())).not.toContain('private-token');
  const reopened = createConnectionsStore({ dataDir, tokenCodec: plaintextTokenCodec });
  expect(await reopened.getDecryptedToken(record.id)).toBe('private-token');
});

it('isolates directories and mutation listeners between store instances', async () => {
  const { createConnectionsStore, plaintextTokenCodec } = await import('../connections-store');
  const firstDir = await mkdtemp(join(tmpdir(), 'standalone-first-'));
  const secondDir = await mkdtemp(join(tmpdir(), 'standalone-second-'));
  dirs.push(firstDir, secondDir);
  const first = createConnectionsStore({ dataDir: firstDir, tokenCodec: plaintextTokenCodec });
  const second = createConnectionsStore({ dataDir: secondDir, tokenCodec: plaintextTokenCodec });
  const listener = vi.fn();
  second.onConnectionsMutated(listener);
  await first.add({
    label: 'Remote',
    host: '192.168.1.10',
    port: 8443,
    fingerprint: 'AA:BB',
    token: 'secret',
  });
  expect(await second.list()).toHaveLength(1);
  expect(listener).not.toHaveBeenCalled();
});
