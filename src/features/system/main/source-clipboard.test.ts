// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createSourceClipboard, type SourceClipboardOwner } from './source-clipboard';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function fixture(maxNativeBytes = 1024 * 1024) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'source-clipboard-test-'));
  let time = Date.now(),
    current = true;
  const listeners = new Set<() => void>();
  const owner: SourceClipboardOwner = {
    key: {},
    current: () => current,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  const publish = vi.fn(async (_text: string) => {});
  const errors = vi.fn();
  const service = createSourceClipboard({
    directory,
    publish,
    maxNativeBytes,
    now: () => time,
    cleanupError: errors,
  });
  const input = (length: number) => ({ id: randomUUID(), length, expiresAt: time + 600000 });
  const leases: Array<{ id: string; token: string }> = [];
  async function begin(text: string) {
    const lease = await service.begin(owner, input(text.length));
    leases.push(lease);
    return { id: lease.id, token: lease.token };
  }
  cleanups.push(async () => {
    for (const lease of leases) await service.abort(owner, lease);
    expect(service.usage()).toEqual({ owners: 0, admittedBytes: 0 });
    expect(listeners.size).toBe(0);
    expect(await fs.readdir(directory)).toEqual([]);
    await fs.rm(directory, { recursive: true, force: true });
  });
  return {
    directory,
    owner,
    publish,
    service,
    input,
    begin,
    listeners,
    errors,
    expire() {
      time += 600000;
    },
    revoke() {
      current = false;
      for (const fn of listeners) fn();
      current = true;
    },
  };
}
it('stages exact UTF8 on private disk and reports admitted native cost only after publication', async () => {
  const f = await fixture(),
    text = 'abc\r\n😀end';
  const lease = await f.begin(text);
  const [dir] = await fs.readdir(f.directory);
  expect((await fs.stat(join(f.directory, dir))).mode & 0o777).toBe(0o700);
  expect((await fs.stat(join(f.directory, dir, 'source'))).mode & 0o777).toBe(0o600);
  const a = await f.service.write(f.owner, { ...lease, sequence: 0, offset: 0, text });
  expect(f.publish).not.toHaveBeenCalled();
  expect(await fs.readFile(join(f.directory, dir, 'source'), 'utf8')).toBe(text);
  const receipt = await f.service.commit(f.owner, a);
  expect(f.publish).toHaveBeenCalledExactlyOnceWith(text);
  expect(receipt).toEqual({
    ...a,
    published: true,
    sha256: createHash('sha256').update(text).digest('hex'),
    admittedBytes: 2 * Buffer.byteLength(text) + 8 * text.length,
  });
  await expect(f.service.commit(f.owner, a)).rejects.toThrow('UNKNOWN');
  expect(f.service.usage()).toEqual({ owners: 0, admittedBytes: 0 });
});
it('publishes owned empty output without a fabricated text write', async () => {
  const f = await fixture(),
    lease = await f.begin('');
  const receipt = await f.service.commit(f.owner, {
    ...lease,
    sequence: 0,
    length: 0,
    utf8Bytes: 0,
  });
  expect(receipt.sha256).toBe(createHash('sha256').update('').digest('hex'));
  expect(f.publish).toHaveBeenCalledExactlyOnceWith('');
});
it('binds tokens to actual owners and rejects stale or forged tokens', async () => {
  const f = await fixture(),
    lease = await f.begin('a');
  const other = { ...f.owner, key: {} };
  const p = { ...lease, sequence: 0, offset: 0, text: 'a' };
  await expect(f.service.write(other, p)).rejects.toThrow('UNKNOWN');
  await expect(f.service.write(f.owner, { ...p, token: randomUUID() })).rejects.toThrow('UNKNOWN');
  await f.service.abort(f.owner, lease);
  await expect(f.service.write(f.owner, p)).rejects.toThrow('UNKNOWN');
  expect(f.publish).not.toHaveBeenCalled();
});
it.each([
  ['offset', { offset: 1 }],
  ['sequence', { sequence: 1 }],
  ['scalar', { text: '\ud800' }],
  ['NUL', { text: '\0' }],
  ['extent', { text: 'ab' }],
])('refuses invalid %s and removes private staging', async (_name, patch) => {
  const f = await fixture(),
    lease = await f.begin('a');
  await expect(
    f.service.write(f.owner, { ...lease, sequence: 0, offset: 0, text: 'a', ...patch }),
  ).rejects.toThrow('INVALID');
  expect(f.publish).not.toHaveBeenCalled();
  expect(f.service.usage().owners).toBe(0);
});
it('requires EOF and the exact accumulated counters before native allocation', async () => {
  const f = await fixture(),
    lease = await f.begin('abc');
  const a = await f.service.write(f.owner, { ...lease, sequence: 0, offset: 0, text: 'a' });
  await expect(f.service.commit(f.owner, a)).rejects.toThrow('INVALID');
  expect(f.publish).not.toHaveBeenCalled();
});
it('denies main O(N) allocation without publishing and releases staging', async () => {
  const f = await fixture(9),
    lease = await f.begin('a');
  const a = await f.service.write(f.owner, { ...lease, sequence: 0, offset: 0, text: 'a' });
  await expect(f.service.commit(f.owner, a)).rejects.toThrow('RESOURCE');
  expect(f.publish).not.toHaveBeenCalled();
  expect(f.service.usage()).toEqual({ owners: 0, admittedBytes: 0 });
});
it('keeps native admission and staging during irreversible publication and concurrent abort', async () => {
  const f = await fixture(),
    lease = await f.begin('a'),
    entered = deferred(),
    held = deferred();
  f.publish.mockImplementation(async () => {
    entered.resolve();
    await held.promise;
  });
  const a = await f.service.write(f.owner, { ...lease, sequence: 0, offset: 0, text: 'a' });
  const pending = f.service.commit(f.owner, a);
  await entered.promise;
  expect(f.service.usage()).toEqual({ owners: 1, admittedBytes: 10 });
  await expect(f.service.commit(f.owner, a)).rejects.toThrow('BUSY');
  let aborted = false;
  const abort = f.service.abort(f.owner, lease).then(() => {
    aborted = true;
  });
  await Promise.resolve();
  expect(aborted).toBe(false);
  f.expire();
  f.revoke();
  expect(f.service.usage().admittedBytes).toBe(10);
  held.resolve();
  expect((await pending).published).toBe(true);
  await abort;
  expect(f.publish).toHaveBeenCalledOnce();
});
it('observes native failure and removes staging without a rollback write', async () => {
  const f = await fixture(),
    lease = await f.begin('a');
  f.publish.mockRejectedValue(new Error('Native failure'));
  const a = await f.service.write(f.owner, { ...lease, sequence: 0, offset: 0, text: 'a' });
  await expect(f.service.commit(f.owner, a)).rejects.toThrow('Native failure');
  expect(f.publish).toHaveBeenCalledOnce();
  expect(f.service.usage()).toEqual({ owners: 0, admittedBytes: 0 });
});
it.each(['owner', 'expiry'])(
  'refuses %s loss after main file hydration before native handoff',
  async (loss) => {
    const f = await fixture(),
      entered = deferred(),
      held = deferred();
    const original = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await original(...args);
      const read = handle.readFile.bind(handle);
      vi.spyOn(handle, 'readFile').mockImplementation(async () => {
        entered.resolve();
        await held.promise;
        return await read({ encoding: 'utf8' });
      });
      return handle;
    });
    const lease = await f.begin('a');
    const a = await f.service.write(f.owner, { ...lease, sequence: 0, offset: 0, text: 'a' });
    const pending = f.service.commit(f.owner, a);
    const refused = expect(pending).rejects.toThrow('REVOKED');
    await entered.promise;
    if (loss === 'owner') f.revoke();
    else f.expire();
    expect(f.service.usage().admittedBytes).toBe(10);
    held.resolve();
    await refused;
    expect(f.publish).not.toHaveBeenCalled();
  },
);
it('admits only one operation per owner before asynchronous filesystem allocation', async () => {
  const f = await fixture();
  const first = f.begin('a');
  await expect(f.service.begin(f.owner, f.input(1))).rejects.toThrow('BUSY');
  const lease = await first;
  await f.service.abort(f.owner, { id: lease.id }); // Lost begin ACK cleanup has no token.
  expect(f.service.usage().owners).toBe(0);
});
it('handles short physical writes without dropping or duplicating bytes', async () => {
  const f = await fixture();
  const original = fs.open.bind(fs);
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await original(...args);
    const write = handle.write.bind(handle);
    vi.spyOn(handle, 'write').mockImplementation(async (buffer, offset, length, position) =>
      write(buffer, offset, Math.min(length ?? 0, 2), position),
    );
    return handle;
  });
  const lease = await f.begin('abc😀');
  const a = await f.service.write(f.owner, { ...lease, sequence: 0, offset: 0, text: 'abc😀' });
  await f.service.commit(f.owner, a);
  expect(f.publish).toHaveBeenCalledExactlyOnceWith('abc😀');
});

it('retains a failed-close handle and private file until an explicit cleanup retry', async () => {
  const f = await fixture();
  const original = fs.open.bind(fs);
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await original(...args);
    const close = handle.close.bind(handle);
    vi.spyOn(handle, 'close')
      .mockRejectedValueOnce(new Error('Close unavailable'))
      .mockImplementation(close);
    return handle;
  });
  const lease = await f.begin('a');
  await expect(f.service.abort(f.owner, lease)).rejects.toThrow('Close unavailable');
  expect(f.service.usage().owners).toBe(1);
  expect(await fs.readdir(f.directory)).toHaveLength(1);
  await f.service.abort(f.owner, lease);
  expect(f.service.usage().owners).toBe(0);
  expect(await fs.readdir(f.directory)).toEqual([]);
  expect(f.publish).not.toHaveBeenCalled();
});
it('waits for a held physical write before retirement cleanup and refuses owner revival', async () => {
  const f = await fixture(),
    entered = deferred(),
    held = deferred();
  const original = fs.open.bind(fs);
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await original(...args);
    const write = handle.write.bind(handle);
    vi.spyOn(handle, 'write').mockImplementation(async (buffer, offset, length, position) => {
      entered.resolve();
      await held.promise;
      return write(buffer, offset, length, position);
    });
    return handle;
  });
  const lease = await f.begin('a');
  const pending = f.service.write(f.owner, { ...lease, sequence: 0, offset: 0, text: 'a' });
  const refused = expect(pending).rejects.toThrow('REVOKED');
  await entered.promise;
  f.revoke();
  expect(f.service.usage().owners).toBe(1);
  expect(await fs.readdir(f.directory)).toHaveLength(1);
  held.resolve();
  await refused;
  await f.service.abort(f.owner, lease);
  expect(f.publish).not.toHaveBeenCalled();
  expect(f.service.usage().owners).toBe(0);
});
