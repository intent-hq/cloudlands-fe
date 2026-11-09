import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../main/dock-window', () => ({ getDockWindow: () => null }));
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/fake/dist/main' } }));
const logged = vi.hoisted(() => [] as { message: string; data: unknown }[]);
vi.mock('../../../shared/logger', () => ({
  Logger: class {
    info(message: string, data?: unknown) {
      logged.push({ message, data });
    }
    warn() {}
    error() {}
    debug() {}
  },
}));

import type { ChildProcess } from 'node:child_process';
import { DockElementPicker, parseDockHitReply } from './dock-element-pick';

class FakeHelper extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  exitCode: number | null = null;
  commands: Record<string, unknown>[] = [];
  constructor() {
    super();
    this.stdin.setEncoding('utf8');
    this.stdin.on('data', (chunk: string) => {
      for (const line of chunk.split('\n').filter(Boolean)) this.commands.push(JSON.parse(line));
    });
  }
  reply(message: Record<string, unknown>) {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }
  kill() {
    this.exitCode = 0;
    this.emit('exit', 0);
    return true;
  }
}

function picker(
  platform: NodeJS.Platform = 'darwin',
  helperPath: string | null = '/helper',
  seeThroughWindowIds: () => number[] = () => [],
) {
  const helpers: FakeHelper[] = [];
  const instance = new DockElementPicker({
    platform,
    helperPath: () => helperPath,
    spawn: () => {
      const helper = new FakeHelper();
      helpers.push(helper);
      return helper as unknown as ChildProcess;
    },
    pid: 4321,
    seeThroughWindowIds,
    timeoutMs: 50,
    maxRestarts: 2,
  });
  return { instance, helpers };
}

const window = {
  pid: 900,
  windowId: 5,
  app: 'Safari',
  bounds: { x: -10, y: 0, width: 800, height: 600 },
};

describe('DockElementPicker', () => {
  it('asks the helper for the window and element under a global point', async () => {
    const { instance, helpers } = picker();
    const pending = instance.hit({ x: -5, y: 20 }, { element: true });
    await vi.waitFor(() => expect(helpers[0]!.commands).toHaveLength(1));
    expect(helpers[0]!.commands[0]).toEqual({
      id: 1,
      cmd: 'hit',
      x: -5,
      y: 20,
      element: true,
      ownPid: 4321,
      seeThroughWindowIds: [],
    });
    helpers[0]!.reply({
      id: 1,
      ok: true,
      trusted: true,
      window,
      element: {
        role: 'AXButton',
        name: 'Buy',
        rect: { x: 0, y: 10, width: 40, height: 20 },
        path: '#buy',
      },
    });
    // An identifier is not a DOM path: it never reaches the mark.
    await expect(pending).resolves.toEqual({
      checked: true,
      access: 'granted',
      window,
      element: { role: 'AXButton', name: 'Buy', rect: { x: 0, y: 10, width: 40, height: 20 } },
    });
  });

  it('sends the dock and overlay IDs as they are at each hit, so a moved or new overlay is never a target', async () => {
    let seeThrough = [11, 12];
    const { instance, helpers } = picker('darwin', '/helper', () => seeThrough);
    void instance.hit({ x: 1, y: 2 }, { element: false });
    seeThrough = [12];
    void instance.hit({ x: 1, y: 2 }, { element: false });
    await vi.waitFor(() => expect(helpers[0]!.commands).toHaveLength(2));
    expect(helpers[0]!.commands.map((command) => command.seeThroughWindowIds)).toEqual([
      [11, 12],
      [12],
    ]);
  });

  it('never surfaces an element without accessibility trust', () => {
    expect(
      parseDockHitReply(
        JSON.stringify({
          id: 3,
          ok: true,
          trusted: false,
          window,
          element: { role: 'AXButton', name: 'x', rect: { x: 0, y: 0, width: 1, height: 1 } },
        }),
      ),
    ).toEqual({ id: 3, hit: { checked: true, access: 'permission', window, element: null } });
  });

  it('degrades to an unchecked answer on timeout, crash, missing binary or other platforms', async () => {
    const { instance, helpers } = picker();
    await expect(instance.hit({ x: 1, y: 1 }, { element: false })).resolves.toMatchObject({
      checked: false,
      access: 'unavailable',
    });
    const crashed = instance.hit({ x: 1, y: 1 }, { element: false });
    helpers[0]!.kill();
    await expect(crashed).resolves.toMatchObject({ checked: false });
    // Respawns after a crash, up to the restart budget.
    void instance.hit({ x: 1, y: 1 }, { element: false });
    expect(helpers).toHaveLength(2);
    helpers[1]!.kill();
    await expect(instance.hit({ x: 1, y: 1 }, { element: false })).resolves.toMatchObject({
      checked: false,
    });
    expect(helpers).toHaveLength(2);
    expect(instance.access()).toBe('unavailable');

    await expect(
      picker('linux').instance.hit({ x: 1, y: 1 }, { element: true }),
    ).resolves.toMatchObject({ checked: false });
    await expect(
      picker('darwin', null).instance.hit({ x: 1, y: 1 }, { element: true }),
    ).resolves.toMatchObject({ checked: false });
  });
});

describe('window-null diagnostic', () => {
  const blocker = { pid: 77, windowId: 4242, layer: 25, bounds: { x: 0, y: 33, width: 1728, height: 1084 }, alpha: 1 };

  it('keeps only bounded window metadata, never names or titles', () => {
    const reply = parseDockHitReply(
      JSON.stringify({
        id: 3, ok: true, trusted: true, window: null, element: null,
        diagnostic: { reason: 'system-layer', listCount: 41, blocker: { ...blocker, app: 'Secret App', name: 'Inbox — me@x' } },
      }),
    );
    expect(reply!.hit.window).toBeNull();
    expect(reply!.hit.diagnostic).toEqual({ reason: 'system-layer', listCount: 41, blocker });
    expect(JSON.stringify(reply)).not.toMatch(/Secret|Inbox/);
  });

  it('drops a malformed diagnostic and ignores one when a window was found', () => {
    const parse = (diagnostic: unknown, win: unknown = null) =>
      parseDockHitReply(JSON.stringify({ id: 1, ok: true, trusted: true, window: win, element: null, diagnostic }))!.hit;
    expect(parse({ reason: 'guess', listCount: 3 }).diagnostic).toBeNull();
    expect(parse({ reason: 'none', listCount: -1 }).diagnostic).toBeNull();
    expect(parse({ reason: 'system-layer', listCount: 3, blocker: { ...blocker, layer: 'x' } }).diagnostic).toEqual({
      reason: 'system-layer', listCount: 3, blocker: null,
    });
    expect(parse({ reason: 'none', listCount: 0 }).diagnostic).toEqual({ reason: 'none', listCount: 0, blocker: null });
    expect(parse({ reason: 'none', listCount: 9 }, window)).not.toHaveProperty('diagnostic');
    // An older helper sends none: the answer is as before.
    expect(parse(undefined)).toMatchObject({ checked: true, window: null, diagnostic: null });
  });

  it('logs one bounded line per checked answer with no window', async () => {
    logged.length = 0;
    const { instance, helpers } = picker();
    const first = instance.hit({ x: 10, y: 20 }, { element: true });
    await vi.waitFor(() => expect(helpers[0]!.commands).toHaveLength(1));
    helpers[0]!.reply({ id: 1, ok: true, trusted: true, window: null, element: null,
      diagnostic: { reason: 'system-layer', listCount: 41, blocker: { ...blocker, app: 'Secret App' } } });
    await first;
    const second = instance.hit({ x: 10, y: 20 }, { element: false });
    await vi.waitFor(() => expect(helpers[0]!.commands).toHaveLength(2));
    helpers[0]!.reply({ id: 2, ok: true, trusted: true, window, element: null });
    await second;
    const lines = logged.filter((row) => row.message === 'Dock element picker found no app window');
    expect(lines).toEqual([
      { message: 'Dock element picker found no app window', data: { reason: 'system-layer', listCount: 41, blocker } },
    ]);
    expect(JSON.stringify(logged)).not.toMatch(/Secret/);
  });
});
