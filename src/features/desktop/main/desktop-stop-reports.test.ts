import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DesktopReportStore } from './desktop-stop-reports';

const storage = vi.hoisted(() => ({ available: true }));
vi.mock('electron', () => ({
  app: { getPath: () => '/unused' },
  safeStorage: {
    isEncryptionAvailable: () => storage.available,
    encryptString: (s: string) => Buffer.from(Buffer.from(s).toString('base64')),
    decryptString: (b: Buffer) => Buffer.from(b.toString(), 'base64').toString(),
  },
}));
const credential = {
  backendId: 'backend-a',
  workspaceId: 'ws',
  agentId: 'agent',
  principalId: 'human',
  sessionId: 'old-session',
  computerId: 'computer',
  connectionEpoch: 'old-epoch',
  stopReportToken: 'secret-token',
};
let dir: string;
async function savedFiles(directory: string) {
  return Promise.all(
    (await fs.readdir(directory))
      .filter((name) => name.endsWith('.enc'))
      .map((name) => fs.readFile(join(directory, name))),
  );
}
beforeEach(async () => {
  storage.available = true;
  dir = await fs.mkdtemp(join(tmpdir(), 'desktop-reports-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});
describe('durable local Stop reports', () => {
  it('retains encrypted credentials before activation and sends nothing until Stop', async () => {
    const filename = join(dir, 'reports');
    const store = new DesktopReportStore(() => filename);
    const send = vi.fn(async () => ({ reported: true, revoked: true }));
    await store.retain(credential);
    store.connect('backend-a', 'human', send);
    await store.flush('backend-a');
    expect(send).not.toHaveBeenCalled();
    expect((await savedFiles(filename)).map((data) => data.toString()).join()).not.toContain(
      'secret-token',
    );
  });
  it('retries the same old tuple and report ID after restart, never another backend', async () => {
    const filename = join(dir, 'reports');
    const store = new DesktopReportStore(() => filename);
    await store.retain(credential);
    await store.queue(credential);
    const send = vi.fn(async () => {
      throw new Error('offline');
    });
    store.connect('backend-a', 'human', send);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const first = send.mock.calls[0];
    const replacement = new DesktopReportStore(() => filename);
    const other = vi.fn(async () => ({ reported: true, revoked: true }));
    replacement.connect('backend-b', 'human', other);
    await replacement.flush('backend-b');
    expect(other).not.toHaveBeenCalled();
    const success = vi.fn(async () => ({ reported: false, revoked: false }));
    replacement.connect('backend-a', 'human', success);
    await vi.waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    expect(success.mock.calls[0]).toEqual(first);
    expect(success).toHaveBeenCalledWith({
      workspaceId: 'ws',
      sessionId: 'old-session',
      reason: 'user_stop',
      stopReport: {
        reportId: expect.any(String),
        computerId: 'computer',
        connectionEpoch: 'old-epoch',
        stopReportToken: 'secret-token',
      },
    });
    await vi.waitFor(async () => {
      const data = JSON.parse(
        Buffer.from((await savedFiles(filename))[0].toString(), 'base64').toString(),
      );
      expect(data).toMatchObject({
        sessionId: 'old-session',
        acknowledged: true,
        reportId: expect.any(String),
      });
    });
  });
  it('does not send old Stop credentials through another principal on the same backend', async () => {
    const store = new DesktopReportStore(() => join(dir, 'reports'));
    await store.queue(credential);
    const send = vi.fn(async () => ({ reported: true, revoked: true }));
    store.connect('backend-a', 'different-human', send);
    await store.flush('backend-a');
    expect(send).not.toHaveBeenCalled();
  });
  it('keeps independent sessions when another app instance writes from a stale view', async () => {
    const directory = join(dir, 'reports');
    const first = new DesktopReportStore(() => directory),
      second = new DesktopReportStore(() => directory);
    await first.retain(credential);
    await second.retain({ ...credential, sessionId: 'new-session' });
    await first.queue(credential);
    const restored = new DesktopReportStore(() => directory);
    const send = vi.fn(async () => ({ reported: true, revoked: true }));
    restored.connect('backend-a', 'human', send);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(await savedFiles(directory)).toHaveLength(2);
  });
  it.each(['forbidden', 'not-found'])(
    'retains %s reports across restart and access restoration',
    async (code) => {
      const directory = join(dir, 'reports');
      const store = new DesktopReportStore(() => directory);
      await store.queue(credential);
      const send = vi.fn(async () => {
        throw { data: { code } };
      });
      store.connect('backend-a', 'human', send);
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      await store.flush('backend-a');
      expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
      const restored = new DesktopReportStore(() => directory);
      const success = vi.fn(async () => ({ revoked: false, reported: true }));
      restored.connect('backend-a', 'human', success);
      await vi.waitFor(() => expect(success).toHaveBeenCalledTimes(1));
      expect(success.mock.calls[0]).toEqual(send.mock.calls[0]);
    },
  );
  it.each([{}, { reported: true }, { reported: 'true', revoked: false }, null])(
    'retains malformed acknowledgement %j',
    async (response) => {
      const directory = join(dir, 'reports');
      const store = new DesktopReportStore(() => directory);
      await store.queue(credential);
      const send = vi.fn(async () => response);
      store.connect('backend-a', 'human', send);
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      await store.flush('backend-a');
      const restored = new DesktopReportStore(() => directory);
      const retry = vi.fn(async () => ({ reported: false, revoked: false }));
      restored.connect('backend-a', 'human', retry);
      await vi.waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
      expect(retry.mock.calls[0]).toEqual(send.mock.calls[0]);
    },
  );
  it('does not poll denied reports without a reconnect or explicit retry', async () => {
    const store = new DesktopReportStore(() => join(dir, 'reports'));
    await store.queue(credential);
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const send = vi.fn(async () => {
      throw { data: { code: 'not-found' } };
    });
    store.connect('backend-a', 'human', send);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await store.flush('backend-a');
    expect(timer.mock.calls.some((call) => call[1] === 30000)).toBe(false);
  });
  it('ignores a late ACK after its authenticated sender disconnects', async () => {
    const directory = join(dir, 'reports');
    const store = new DesktopReportStore(() => directory);
    await store.queue(credential);
    let resolve!: (result: unknown) => void;
    const send = vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    store.connect('backend-a', 'human', send);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    store.disconnect('backend-a', send);
    resolve({ reported: true, revoked: false });
    await new Promise((r) => setTimeout(r, 10));
    const restored = new DesktopReportStore(() => directory);
    const retry = vi.fn(async () => ({ reported: false, revoked: false }));
    restored.connect('backend-a', 'human', retry);
    await vi.waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    expect(retry.mock.calls[0]).toEqual(send.mock.calls[0]);
  });
  it('fails readiness without protected storage, never writes plaintext fallback', async () => {
    storage.available = false;
    const filename = join(dir, 'reports');
    const store = new DesktopReportStore(() => filename);
    await expect(store.retain(credential)).rejects.toMatchObject({
      data: { code: 'desktop-execution-failed' },
    });
    await expect(fs.stat(filename)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('reports write failures and preserves the in-memory notification for retry', async () => {
    const filename = join(dir, 'reports');
    const failure = vi.fn();
    const store = new DesktopReportStore(() => filename, failure);
    await store.retain(credential);
    const spy = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk full'));
    await expect(store.queue(credential)).rejects.toThrow('disk full');
    expect(failure).toHaveBeenCalled();
    spy.mockRestore();
    const send = vi.fn(async () => ({ reported: true, revoked: true }));
    store.connect('backend-a', 'human', send);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  });
});
