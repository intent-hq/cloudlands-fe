/**
 * @vitest-environment node
 *
 * Discovery folder reader (protocol §5.58 Discovery record): record parsing,
 * the reader rules (regular files only, size, owner, version, capability),
 * stale records and hiding this app's own daemon.
 */
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CURRENT_PROTOCOL_VERSION } from '../../../test/current-protocol-version';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  desktopProductName,
  localDaemonsDir,
  MAX_RECORD_BYTES,
  parseLocalDaemonRecord,
  readLocalDaemons,
} from './local-daemon-discovery';

const FP = Array.from({ length: 32 }, (_, i) => (i + 16).toString(16).toUpperCase()).join(':');
const OTHER_FP = FP.replace(/^10/, 'AA');

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    instanceId: '6f1d2c1e-0000-4000-8000-000000000001',
    pid: 4242,
    startedAt: '2026-11-12T00:00:00Z',
    updatedAt: '2026-11-12T00:00:01Z',
    displayName: 'Intent Alpha',
    dataDir: '/Users/me/Library/Application Support/intentd-alpha',
    daemonVersion: '0.400.0',
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    port: 51234,
    fingerprint: FP,
    capabilities: { localCodePairing: 1 },
    ...overrides,
  };
}

describe('parseLocalDaemonRecord', () => {
  it('parses a supported record and normalizes the fingerprint', () => {
    const parsed = parseLocalDaemonRecord(
      JSON.stringify(record({ fingerprint: FP.toLowerCase().replaceAll(':', '') })),
    );
    expect(parsed).toEqual({
      instanceId: '6f1d2c1e-0000-4000-8000-000000000001',
      pid: 4242,
      displayName: 'Intent Alpha',
      dataDir: '/Users/me/Library/Application Support/intentd-alpha',
      daemonVersion: '0.400.0',
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      port: 51234,
      fingerprint: FP,
    });
  });

  it('keeps a record whose listener is down as port null', () => {
    expect(parseLocalDaemonRecord(JSON.stringify(record({ port: null })))?.port).toBeNull();
  });

  it.each([
    ['junk', 'not json'],
    ['an array', '[]'],
    ['version 2', JSON.stringify(record({ version: 2 }))],
    ['no capabilities', JSON.stringify(record({ capabilities: {} }))],
    ['capability 2', JSON.stringify(record({ capabilities: { localCodePairing: 2 } }))],
    ['capability "1"', JSON.stringify(record({ capabilities: { localCodePairing: '1' } }))],
    ['a path-like instance id', JSON.stringify(record({ instanceId: '../evil' }))],
    ['pid 0', JSON.stringify(record({ pid: 0 }))],
    ['a fractional pid', JSON.stringify(record({ pid: 1.5 }))],
    ['port 0', JSON.stringify(record({ port: 0 }))],
    ['port 70000', JSON.stringify(record({ port: 70000 }))],
    ['a string port', JSON.stringify(record({ port: '51234' }))],
    ['a short fingerprint', JSON.stringify(record({ fingerprint: 'AB:CD' }))],
    ['no display name', JSON.stringify(record({ displayName: '  ' }))],
    ['no data folder', JSON.stringify(record({ dataDir: '' }))],
  ])('skips %s', (_label, raw) => {
    expect(parseLocalDaemonRecord(raw)).toBeNull();
  });

  it('strips control characters from the display name', () => {
    expect(
      parseLocalDaemonRecord(JSON.stringify(record({ displayName: 'Intent\u0007 Dev\n' })))
        ?.displayName,
    ).toBe('Intent Dev');
  });
});

describe('localDaemonsDir', () => {
  it('follows the contract folders and the override', () => {
    expect(localDaemonsDir({}, 'darwin', '/Users/me')).toBe(
      '/Users/me/Library/Application Support/Intent/local-daemons',
    );
    expect(localDaemonsDir({ XDG_RUNTIME_DIR: '/run/user/1000' }, 'linux', '/home/me')).toBe(
      '/run/user/1000/intent/local-daemons',
    );
    expect(localDaemonsDir({}, 'linux', '/home/me')).toBe(
      '/home/me/.local/state/intent/local-daemons',
    );
    expect(
      localDaemonsDir({ LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, 'win32', 'C:\\Users\\me'),
    ).toBe('C:\\Users\\me\\AppData\\Local\\Intent\\local-daemons');
    expect(localDaemonsDir({ INTENT_LOCAL_DAEMONS_DIR: ' /tmp/daemons ' }, 'darwin', '/x')).toBe(
      '/tmp/daemons',
    );
  });
});

describe('readLocalDaemons', () => {
  let dir: string;
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const alive = new Set([4242, 4343, 4444]);
  const isRunning = (pid: number) => alive.has(pid);
  const noOwn = { fingerprint: null, dataDir: null };

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'local-daemons-'));
  });
  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  const write = (name: string, value: unknown) =>
    fsp.writeFile(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));

  it('lists live supported records sorted by name, skipping junk and other files', async () => {
    await write(
      'b.json',
      record({ instanceId: 'b', displayName: 'Intent', pid: 4343, fingerprint: OTHER_FP }),
    );
    await write('a.json', record({ instanceId: 'a', displayName: 'Intent Alpha' }));
    await write('junk.json', '{');
    await write('old.json', record({ instanceId: 'old', version: 0 }));
    await write('notes.txt', record({ instanceId: 'txt' }));
    const records = await readLocalDaemons({ dir, uid, isRunning }, noOwn);
    expect(records?.map((r) => r.instanceId)).toEqual(['b', 'a']);
  });

  it('skips a record whose process is gone (stale after a crash)', async () => {
    await write('live.json', record({ instanceId: 'live' }));
    await write('stale.json', record({ instanceId: 'stale', pid: 999_999 }));
    const records = await readLocalDaemons({ dir, uid, isRunning }, noOwn);
    expect(records?.map((r) => r.instanceId)).toEqual(['live']);
  });

  it('hides its own daemon by fingerprint, instance id or data folder', async () => {
    await write('own-fp.json', record({ instanceId: 'own-fp', dataDir: '/a' }));
    await write(
      'own-id.json',
      record({ instanceId: 'own-id', dataDir: '/b', fingerprint: OTHER_FP }),
    );
    await write(
      'own-dir.json',
      record({ instanceId: 'own-dir', dataDir: '/data/own/', fingerprint: OTHER_FP }),
    );
    await write(
      'other.json',
      record({ instanceId: 'other', dataDir: '/c', fingerprint: OTHER_FP }),
    );
    const records = await readLocalDaemons(
      { dir, uid, isRunning },
      { fingerprint: FP.toLowerCase(), instanceId: 'own-id', dataDir: '/data/own' },
    );
    expect(records?.map((r) => r.instanceId)).toEqual(['other']);
  });

  it('never follows a symlinked record', async () => {
    const outside = path.join(dir, '..', `${path.basename(dir)}-target.json`);
    await fsp.writeFile(outside, JSON.stringify(record({ instanceId: 'linked' })));
    try {
      await fsp.symlink(outside, path.join(dir, 'linked.json'));
      const records = await readLocalDaemons({ dir, uid, isRunning }, noOwn);
      expect(records).toEqual([]);
    } finally {
      await fsp.rm(outside, { force: true });
    }
  });

  it('skips a record larger than 16 KiB', async () => {
    await write(
      'big.json',
      JSON.stringify(record({ instanceId: 'big', padding: 'x'.repeat(MAX_RECORD_BYTES) })),
    );
    expect(await readLocalDaemons({ dir, uid, isRunning }, noOwn)).toEqual([]);
  });

  it('skips a record owned by another user', async () => {
    if (uid === null) return;
    await write('mine.json', record({ instanceId: 'mine' }));
    await write('theirs.json', record({ instanceId: 'theirs' }));
    const fs = {
      readdir: fsp.readdir,
      open: fsp.open,
      lstat: (async (file: string) => {
        const stat = await fsp.lstat(file);
        return file.endsWith('theirs.json') ? Object.assign(stat, { uid: uid + 1 }) : stat;
      }) as typeof fsp.lstat,
    };
    const records = await readLocalDaemons({ dir, uid, isRunning, fs }, noOwn);
    expect(records?.map((r) => r.instanceId)).toEqual(['mine']);
  });

  it('refuses a folder owned by someone else and treats a missing folder as empty', async () => {
    if (uid !== null) {
      expect(await readLocalDaemons({ dir, uid: uid + 1, isRunning }, noOwn)).toBeNull();
    }
    expect(
      await readLocalDaemons({ dir: path.join(dir, 'missing'), uid, isRunning }, noOwn),
    ).toEqual([]);
  });

  it('refuses a symlinked folder', async () => {
    const link = `${dir}-link`;
    await fsp.symlink(dir, link);
    try {
      expect(await readLocalDaemons({ dir: link, uid, isRunning }, noOwn)).toBeNull();
    } finally {
      await fsp.rm(link, { force: true });
    }
  });

  it('lists one record per instance id', async () => {
    await write('one.json', record({ instanceId: 'same' }));
    await write('two.json', record({ instanceId: 'same' }));
    expect((await readLocalDaemons({ dir, uid, isRunning }, noOwn))?.length).toBe(1);
  });
});

describe('desktopProductName', () => {
  it('marks unpackaged builds as dev builds', () => {
    expect(desktopProductName('Intent', true)).toBe('Intent');
    expect(desktopProductName('Intent', false)).toBe('Intent (dev build)');
    expect(desktopProductName('  ', true)).toBe('Intent');
  });
});
