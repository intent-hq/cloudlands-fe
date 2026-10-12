import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../shared/ipc-registry';
import type { BackendRuntime } from '../../lib/client/live/backend-transport-runtime';
import type { InstalledEditor } from '../../store/renderer/slices/external-editors/external-editors-slice';
import { createExternalEditorReadRuntime } from './external-editor-read';
import {
  createExternalEditorsClient,
  type DetectInstalledResponse,
} from './external-editors-client-factory';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function readFixture(reply: unknown = { editors: [] }) {
  const visits: string[] = [];
  let context: string | null = 'host-a';
  const request = vi.fn<
    (...args: Parameters<BackendRuntime['backendRequest']>) => Promise<unknown>
  >(async () => {
    visits.push('request');
    return reply;
  });
  const reads = createExternalEditorReadRuntime({
    // Only the declared generic transport fixture erases response type; return the exact Promise.
    backendRequest: <T>(...args: Parameters<BackendRuntime['backendRequest']>) =>
      request(...args) as Promise<T>,
    getHostAdministrationContext: () => {
      visits.push('context');
      return context;
    },
  });
  return {
    reads,
    request,
    visits,
    setContext(value: string | null) {
      context = value;
    },
  };
}
function clientFixture(response: unknown) {
  const delivered = Promise.resolve(response);
  const invoke = vi.fn(
    (_channel: string, _params: { forceRefresh: boolean }) =>
      // Declared delivery boundary may supply malformed data; production guards remain under test.
      delivered as Promise<DetectInstalledResponse>,
  );
  return { delivered, invoke, client: createExternalEditorsClient({ invoke }) };
}

const installed: InstalledEditor[] = [
  {
    id: 'vscode',
    name: 'VS Code',
    shortLabel: 'VS Code',
    appName: 'Visual Studio Code',
    category: 'ide',
    handlerType: 'vscode',
    bundleId: 'com.microsoft.VSCode',
    priority: 10,
    installed: true,
  },
];

describe('canonical external editor daemon read', () => {
  it('constructs without authority or transport reads and preserves the raw array for both consumers', async () => {
    const entries = Object.freeze([
      Object.freeze({ id: 'webstorm', installed: true, path: '/fixture/ide', source: 'path' }),
      Object.freeze({ id: 'unknown-editor', installed: false, flatpakId: 'org.fixture.Unknown' }),
    ]);
    const f = readFixture({ editors: entries });
    expect(f.visits).toEqual([]);
    expect(f.request).not.toHaveBeenCalled();
    expect(await f.reads.listInstalledEditors()).toBe(entries);
    expect(f.request.mock.calls).toEqual([['host.listInstalledEditors']]);
    expect(f.visits).toEqual(['context', 'request', 'context']);
  });

  it('returns empty success without a host request when administration is refused', async () => {
    const f = readFixture();
    f.setContext(null);
    expect(await f.reads.detectInstalledEditors()).toEqual({ success: true, data: [] });
    expect(f.visits).toEqual(['context']);
    expect(f.request).not.toHaveBeenCalled();
  });

  it.each(['host-b', null])(
    'drops a held response when the live administration context becomes %s',
    async (next) => {
      const f = readFixture();
      const held = deferred<unknown>();
      f.request.mockImplementationOnce(() => {
        f.visits.push('request');
        return held.promise;
      });
      const read = f.reads.detectInstalledEditors();
      f.setContext(next);
      held.resolve({ editors: [{ id: 'vscode', installed: true }] });
      expect(await read).toEqual({ success: true, data: [] });
      expect(f.visits).toEqual(['context', 'request', 'context']);
    },
  );

  it('enriches known IDs in response order, forces Finder and ignores untrusted display metadata', async () => {
    const f = readFixture({
      editors: [
        { id: 'unknown-editor', installed: true },
        { id: 'finder', installed: false, name: 'forged finder', path: '/wrong/path' },
        { id: 'vscode', installed: true, name: 'forged vscode', handlerType: 'finder' },
        { id: 'warp', installed: false },
      ],
    });
    const result = await f.reads.detectInstalledEditors();
    expect(result.success).toBe(true);
    expect(
      result.data?.map((entry) => ({
        id: entry.id,
        installed: entry.installed,
        handlerType: entry.handlerType,
      })),
    ).toEqual([
      { id: 'finder', installed: true, handlerType: 'finder' },
      { id: 'vscode', installed: true, handlerType: 'vscode' },
      { id: 'warp', installed: false, handlerType: 'generic' },
    ]);
    expect(result.data?.[0]).toMatchObject({ name: 'Finder', bundleId: 'com.apple.finder' });
    expect(result.data?.[1]).toMatchObject({
      name: 'VS Code',
      bundleId: 'com.microsoft.VSCode',
      category: 'ide',
    });
    expect(result.data?.[0]).not.toHaveProperty('path');
    expect(result.data?.[1]).not.toHaveProperty('source');
  });

  it.each([undefined, null, {}, { editors: null }, { editors: {} }])(
    'retains empty-list fallback for malformed catalog %j',
    async (reply) => {
      const f = readFixture();
      f.request.mockResolvedValueOnce(reply);
      expect(await f.reads.detectInstalledEditors()).toEqual({ success: true, data: [] });
    },
  );

  it('retains the error envelope for a malformed member of an otherwise valid array', async () => {
    const f = readFixture({ editors: [null] });
    const result = await f.reads.detectInstalledEditors();
    expect(result.success).toBe(false);
    expect(result.error).toEqual(expect.any(String));
    expect(result.error).not.toBe('');
    expect(result).not.toHaveProperty('data');
  });

  it.each([new Error('transport refused'), 'wire refused'])(
    'folds a backend rejection without an extra authority read',
    async (error) => {
      const f = readFixture();
      f.request.mockRejectedValueOnce(error);
      expect(await f.reads.detectInstalledEditors()).toEqual({
        success: false,
        error: error instanceof Error ? 'transport refused' : 'wire refused',
      });
      expect(f.visits).toEqual(['context']);
      expect(f.request.mock.calls).toEqual([['host.listInstalledEditors']]);
    },
  );

  it('preserves a held request error even when authority changes before rejection', async () => {
    const f = readFixture();
    const held = deferred<unknown>();
    f.request.mockReturnValueOnce(held.promise);
    const read = f.reads.detectInstalledEditors();
    f.setContext(null);
    held.reject(new Error('late transport failure'));
    expect(await read).toEqual({ success: false, error: 'late transport failure' });
    expect(f.visits).toEqual(['context']);
  });

  it('does not cache or coalesce successive read requests', async () => {
    const f = readFixture();
    f.request.mockResolvedValueOnce({ editors: [{ id: 'vscode', installed: true }] });
    f.request.mockResolvedValueOnce({ editors: [{ id: 'vscode', installed: false }] });
    const first = await f.reads.detectInstalledEditors();
    const second = await f.reads.detectInstalledEditors();
    expect(first.data?.[0].installed).toBe(true);
    expect(second.data?.[0].installed).toBe(false);
    expect(f.request.mock.calls).toEqual([
      ['host.listInstalledEditors'],
      ['host.listInstalledEditors'],
    ]);
  });
});

describe('canonical external editor public client', () => {
  it.each([
    { name: 'omitted', provided: false, force: false },
    { name: 'false', provided: true, force: false },
    { name: 'true', provided: true, force: true },
  ])(
    'sends the exact $name force payload and returns the delivered array through the original async layer',
    async ({ provided, force }) => {
      const f = clientFixture({ success: true, data: installed });
      expect(f.invoke).not.toHaveBeenCalled();
      const pending = provided ? f.client.detectInstalled(force) : f.client.detectInstalled();
      expect(pending).not.toBe(f.delivered);
      expect(await pending).toBe(installed);
      expect(f.invoke.mock.calls).toEqual([
        [IPC_CHANNELS.EXTERNAL_EDITORS.DETECT_INSTALLED, { forceRefresh: force }],
      ]);
    },
  );

  it.each([
    undefined,
    null,
    {},
    { success: true },
    { success: true, data: {} },
    { success: false, data: installed },
    { success: false, error: '' },
  ])('retains the public fallback error for malformed envelope %j', async (response) => {
    const f = clientFixture(response);
    await expect(f.client.detectInstalled()).rejects.toThrow('Failed to detect editors');
  });

  it('preserves an explicit failure message from the detection handler', async () => {
    const f = clientFixture({ success: false, error: 'daemon unavailable' });
    await expect(f.client.detectInstalled()).rejects.toThrow('daemon unavailable');
  });

  it('propagates an invoke rejection without wrapping its Error', async () => {
    const error = new Error('delivery failed');
    const invoke = vi.fn(async () => {
      throw error;
    });
    const client = createExternalEditorsClient({ invoke });
    await expect(client.detectInstalled()).rejects.toBe(error);
  });
});
