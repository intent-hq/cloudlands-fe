// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { BROWSER_ACCESS_DEFAULT_PORT } from '../../../shared/types/browser-access';
import {
  PREF_ACCESS_KEY,
  PREF_ENABLED,
  PREF_PAGE_ORIGIN,
  PREF_PORT,
  createBrowserAccessController,
  type BrowserAccessControllerDeps,
} from './browser-access-controller';
import type { BrowserAccessServer } from './browser-access-server';

type SignInHooks = Parameters<BrowserAccessControllerDeps['createServer']>[1];

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

function webRoot(withBuild = true): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bac-'));
  dirs.push(dir);
  if (withBuild) fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
  return dir;
}

class FakeServer implements BrowserAccessServer {
  listening: number | null = null;
  closed = false;
  disconnects = 0;
  constructor(
    private readonly busyPorts: Set<number>,
    readonly getAccessKey: () => string,
    readonly signIn: SignInHooks,
  ) {}
  async listen(port: number): Promise<number> {
    if (this.busyPorts.has(port)) {
      throw Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
    }
    this.listening = port;
    return port;
  }
  disconnectAll(): void {
    this.disconnects++;
  }
  async close(): Promise<void> {
    this.closed = true;
    this.listening = null;
  }
}

function setup(
  stored: Record<string, unknown> = {},
  options: { withBuild?: boolean; busy?: number[] } = {},
) {
  const prefs = new Map<string, unknown>(Object.entries(stored));
  const servers: FakeServer[] = [];
  const busy = new Set(options.busy ?? []);
  const controller = createBrowserAccessController({
    prefs: {
      get: async (key) => prefs.get(key),
      set: async (key, value) => void prefs.set(key, value),
    },
    webRoot: webRoot(options.withBuild ?? true),
    log: { info() {}, warn() {} },
    createServer: (getAccessKey, signIn) => {
      const server = new FakeServer(busy, getAccessKey, signIn);
      servers.push(server);
      return server;
    },
  });
  const live = () => servers.filter((server) => server.listening !== null);
  return { controller, prefs, servers, live, busy };
}

describe('createBrowserAccessController', () => {
  it('starts off with a generated, persisted access key and the default port', async () => {
    const { controller, prefs, servers } = setup();
    const state = await controller.load();
    expect(state).toMatchObject({
      enabled: false,
      running: false,
      port: BROWSER_ACCESS_DEFAULT_PORT,
      error: null,
    });
    expect(state.available).toBe(true);
    expect(state.accessKey).toHaveLength(43);
    expect(prefs.get(PREF_ACCESS_KEY)).toBe(state.accessKey);
    expect(servers).toHaveLength(0);
  });

  it('keeps a stored key and starts on load when enabled', async () => {
    const key = 'k'.repeat(43);
    const { controller, live } = setup({
      [PREF_ENABLED]: true,
      [PREF_PORT]: 50000,
      [PREF_ACCESS_KEY]: key,
    });
    const state = await controller.load();
    expect(state).toMatchObject({ enabled: true, running: true, port: 50000, accessKey: key });
    expect(live()[0]?.listening).toBe(50000);
    expect(live()[0]?.getAccessKey()).toBe(key);
  });

  it('ignores an invalid stored port', async () => {
    const { controller } = setup({ [PREF_PORT]: 80 });
    expect((await controller.load()).port).toBe(BROWSER_ACCESS_DEFAULT_PORT);
  });

  it('turns on and off, persisting the choice', async () => {
    const { controller, prefs, live, servers } = setup();
    await controller.load();
    expect((await controller.setEnabled(true)).running).toBe(true);
    expect(prefs.get(PREF_ENABLED)).toBe(true);
    const off = await controller.setEnabled(false);
    expect(off).toMatchObject({ enabled: false, running: false });
    expect(prefs.get(PREF_ENABLED)).toBe(false);
    expect(live()).toHaveLength(0);
    expect(servers[0]?.closed).toBe(true);
  });

  it('reports a busy port and recovers on another port', async () => {
    const { controller, live } = setup({}, { busy: [BROWSER_ACCESS_DEFAULT_PORT] });
    await controller.load();
    const failed = await controller.setEnabled(true);
    expect(failed).toMatchObject({ enabled: true, running: false, error: 'port-in-use' });
    const moved = await controller.setPort(50001);
    expect(moved).toMatchObject({ running: true, error: null, port: 50001 });
    expect(live()).toHaveLength(1);
  });

  it('restarts on a port change only while enabled', async () => {
    const { controller, servers } = setup();
    await controller.load();
    await controller.setPort(50002);
    expect(servers).toHaveLength(0);
    await controller.setEnabled(true);
    await controller.setPort(50003);
    expect(servers.map((server) => server.closed)).toEqual([true, false]);
    expect(servers[1]?.listening).toBe(50003);
  });

  it('rejects invalid ports', async () => {
    const { controller } = setup();
    await controller.load();
    await expect(controller.setPort(80)).rejects.toThrow(/invalid port/);
  });

  it('reports when the build has no web UI', async () => {
    const { controller, servers } = setup({}, { withBuild: false });
    await controller.load();
    const state = await controller.setEnabled(true);
    expect(state).toMatchObject({ available: false, running: false, error: 'unavailable' });
    expect(servers).toHaveLength(0);
  });

  it('resets the key live and disconnects connected browsers', async () => {
    const { controller, prefs, live } = setup();
    const before = (await controller.load()).accessKey;
    await controller.setEnabled(true);
    const after = (await controller.resetKey()).accessKey;
    expect(after).not.toBe(before);
    expect(prefs.get(PREF_ACCESS_KEY)).toBe(after);
    expect(live()[0]?.getAccessKey()).toBe(after);
    expect(live()[0]?.disconnects).toBe(1);
  });

  it('stops on shutdown but keeps the setting', async () => {
    const { controller, prefs, live } = setup();
    await controller.load();
    await controller.setEnabled(true);
    await controller.shutdown();
    expect(live()).toHaveLength(0);
    expect(prefs.get(PREF_ENABLED)).toBe(true);
  });

  it('creates sign-in codes only while serving, with a link once a page origin is known', async () => {
    const { controller, servers, prefs } = setup();
    await controller.load();
    await expect(controller.createSignInCode()).rejects.toThrow();
    await controller.setEnabled(true);
    const withoutOrigin = await controller.createSignInCode();
    expect(withoutOrigin.code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    expect(withoutOrigin.link).toBeNull();

    servers.at(-1)!.signIn.onPageOrigin('https://box.ts.net');
    await vi.waitFor(() => expect(prefs.get(PREF_PAGE_ORIGIN)).toBe('https://box.ts.net'));
    const created = await controller.createSignInCode();
    expect(created.link).toBe(
      `https://box.ts.net/__browser-access/login?code=${created.code.replace('-', '')}`,
    );
    expect(await servers.at(-1)!.signIn.consumeSignInCode(created.code)).toBe('ok');
    expect(await servers.at(-1)!.signIn.consumeSignInCode(created.code)).toBe('used-or-expired');
  });

  it('keeps the page origin across restarts, preferring a front-end over loopback', async () => {
    const first = setup({ [PREF_ENABLED]: true, [PREF_PAGE_ORIGIN]: 'https://box.ts.net' });
    await first.controller.load();
    first.servers[0].signIn.onPageOrigin('http://127.0.0.1:47120');
    const created = await first.controller.createSignInCode();
    expect(created.link?.startsWith('https://box.ts.net/')).toBe(true);
    expect(first.prefs.get(PREF_PAGE_ORIGIN)).toBe('https://box.ts.net');
  });

  it('invalidates sign-in codes when the key is reset', async () => {
    const { controller, servers } = setup({ [PREF_ENABLED]: true });
    await controller.load();
    const { code } = await controller.createSignInCode();
    await controller.resetKey();
    expect(await servers[0].signIn.consumeSignInCode(code)).toBe('invalid');
  });
});
