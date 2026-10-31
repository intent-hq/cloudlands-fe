import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../main/dock-window', () => ({ getDockWindow: () => null }));
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/fake/dist/main' } }));

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
