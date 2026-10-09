// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { CustomViewsService } from './custom-views.service';
import type {
  CustomViewInput,
  CustomViewsResponse,
  CustomViewsSnapshot,
} from '../../../shared/types/custom-views';

function snapshot(response: CustomViewsResponse): CustomViewsSnapshot {
  expect(response.success).toBe(true);
  if (!response.success) throw new Error(response.error.message);
  return response.data;
}

describe('desktop custom view lifecycle', () => {
  let directory: string;
  let file: string;
  let service: CustomViewsService;
  let input: CustomViewInput;
  const children: ChildProcess[] = [];
  const spawn = vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    }) as unknown as ChildProcess;
    children.push(child);
    return child;
  });
  const stop = vi.fn(async () => {});
  const portAvailable = vi.fn(async () => true);
  const probe = vi.fn<(url: string, signal: AbortSignal) => Promise<boolean>>(async () => false);

  beforeEach(async () => {
    vi.clearAllMocks();
    children.length = 0;
    portAvailable.mockResolvedValue(true);
    probe.mockResolvedValue(false);
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'custom-views-'));
    file = path.join(directory, 'registrations.json');
    service = new CustomViewsService(file, {
      spawn,
      stop,
      portAvailable,
      probe,
      startupTimeoutMs: 50,
      pollIntervalMs: 2,
    });
    input = { name: 'Dashboard', directory, command: 'node server.js', port: 39123, icon: 'globe' };
  });
  afterEach(async () => {
    await service.dispose();
    vi.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
  });

  async function save() {
    return snapshot(await service.save(input)).views[0];
  }

  it('serializes writes and reloads registrations without starting commands', async () => {
    const [first, second] = await Promise.all([
      service.save(input),
      service.save({ ...input, name: 'Other', port: 39124 }),
    ]);
    expect(snapshot(first).views).toHaveLength(1);
    expect(snapshot(second).views).toHaveLength(2);
    const reloaded = new CustomViewsService(file);
    expect(snapshot(await reloaded.list()).views.map((view) => view.name)).toEqual([
      'Dashboard',
      'Other',
    ]);
    expect(snapshot(await reloaded.list()).runtimes.map((runtime) => runtime.status)).toEqual([
      'stopped',
      'stopped',
    ]);
    expect(spawn).not.toHaveBeenCalled();
    await reloaded.dispose();
  });

  it('rejects malformed input, unknown IDs, unavailable directories and duplicate ports', async () => {
    for (const change of [
      { port: 80 },
      { port: 70000 },
      { port: 1024.5 },
      { icon: 'anything' },
      { command: ' ' },
      { directory: 'relative' },
      { id: 'oops' },
    ]) {
      expect(await service.save({ ...input, ...change })).toMatchObject({
        success: false,
        error: { code: 'invalid-input' },
      });
    }
    expect(
      await service.save({ ...input, directory: path.join(directory, 'missing') }),
    ).toMatchObject({ success: false, error: { code: 'directory-unavailable' } });
    await save();
    expect(await service.save(input)).toMatchObject({
      success: false,
      error: { code: 'port-in-use' },
    });
    expect(await service.stop({ id: 'be2863d7-2e79-4ed4-a77f-29fa1fbf263d' })).toMatchObject({
      success: false,
      error: { code: 'not-found' },
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('does not overwrite corrupt storage or report failed persistence as saved', async () => {
    await fs.writeFile(file, '{broken');
    expect(await service.save(input)).toMatchObject({
      success: false,
      error: { code: 'storage-failed' },
    });
    expect(await fs.readFile(file, 'utf8')).toBe('{broken');
    await fs.rm(file);
    const view = await save();
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk full'));
    expect(await service.save({ ...view, name: 'Changed' })).toMatchObject({
      success: false,
      error: { code: 'storage-failed' },
    });
    expect(snapshot(await service.list()).views[0].name).toBe('Dashboard');
    expect(JSON.parse(await fs.readFile(file, 'utf8'))[0].name).toBe('Dashboard');
  });

  it('rejects occupied ports without HTTP before spawning or exposing an iframe URL', async () => {
    const view = await save();
    portAvailable.mockResolvedValue(false);
    const runtime = snapshot(await service.start({ id: view.id })).runtimes[0];
    expect(runtime).toMatchObject({ status: 'error', errorCode: 'port-in-use' });
    expect(runtime.url).toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('reuses HTTP on an occupied port even if the saved directory has disappeared', async () => {
    input.directory = path.join(directory, 'server');
    await fs.mkdir(input.directory);
    const view = await save();
    await fs.rmdir(input.directory);
    portAvailable.mockResolvedValue(false);
    probe.mockResolvedValue(true);
    const responses = await Promise.all([
      service.start({ id: view.id }),
      service.start({ id: view.id }),
    ]);
    for (const response of responses) {
      expect(snapshot(response).runtimes[0]).toMatchObject({
        status: 'running',
        external: true,
        url: 'http://127.0.0.1:39123/',
        logs: '',
      });
    }
    expect(spawn).not.toHaveBeenCalled();
    await service.stop({ id: view.id });
    portAvailable.mockResolvedValue(true);
    expect(snapshot(await service.start({ id: view.id })).runtimes[0]).toMatchObject({
      status: 'error',
      errorCode: 'directory-unavailable',
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('disconnects, edits, removes and quits external views without stopping their servers', async () => {
    const view = await save();
    portAvailable.mockResolvedValue(false);
    probe.mockResolvedValue(true);
    await service.start({ id: view.id });
    const disconnected = snapshot(await service.stop({ id: view.id })).runtimes[0];
    expect(disconnected).toMatchObject({ status: 'stopped', external: true });
    expect(disconnected.url).toBeUndefined();
    probe.mockClear();
    await service.list();
    expect(probe).not.toHaveBeenCalled();
    await service.start({ id: view.id });
    await service.save({ ...view, name: 'Renamed' });
    expect(snapshot(await service.list()).runtimes[0].status).toBe('stopped');
    await service.start({ id: view.id });
    await service.remove({ id: view.id });
    expect(snapshot(await service.list()).views).toEqual([]);
    const next = await save();
    await service.start({ id: next.id });
    await service.dispose();
    expect(stop).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('detects a lost external server and uses the command only on a later start with a free port', async () => {
    const view = await save();
    portAvailable.mockResolvedValue(false);
    probe.mockResolvedValue(true);
    await service.start({ id: view.id });
    probe.mockResolvedValue(false);
    const lost = snapshot(await service.list()).runtimes[0];
    expect(lost).toMatchObject({ status: 'error', external: true, errorCode: 'server-exited' });
    expect(lost.url).toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
    portAvailable.mockResolvedValue(true);
    const started = snapshot(await service.start({ id: view.id })).runtimes[0];
    expect(started.status).toBe('starting');
    expect(started.external).toBeUndefined();
    expect(spawn).toHaveBeenCalledOnce();
    await service.stop({ id: view.id });
    expect(stop).toHaveBeenCalledWith(children[0]);
  });

  it('quit aborts an external probe and prevents a late attachment', async () => {
    const view = await save();
    portAvailable.mockResolvedValue(false);
    let finishProbe!: (ready: boolean) => void;
    probe.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishProbe = resolve;
        }),
    );
    const starting = service.start({ id: view.id });
    await vi.waitFor(() => expect(finishProbe).toBeTypeOf('function'), { interval: 5 });
    const signal = probe.mock.calls[0][1];
    const quitting = service.dispose();
    expect(signal.aborted).toBe(true);
    finishProbe(true);
    const runtime = snapshot(await starting).runtimes[0];
    expect(runtime.status).toBe('error');
    expect(runtime.url).toBeUndefined();
    expect(runtime.external).toBeUndefined();
    await quitting;
    expect(spawn).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent starts and exposes the URL only after HTTP readiness', async () => {
    const view = await save();
    await Promise.all([service.start({ id: view.id }), service.start({ id: view.id })]);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(snapshot(await service.list()).runtimes[0]).toMatchObject({ status: 'starting' });
    expect(snapshot(await service.list()).runtimes[0].url).toBeUndefined();
    probe.mockResolvedValue(true);
    await vi.waitFor(
      async () =>
        expect(snapshot(await service.list()).runtimes[0]).toMatchObject({
          status: 'running',
          url: 'http://127.0.0.1:39123/',
        }),
      { interval: 5 },
    );
  });

  it('bounds logs and cleans up commands that never become ready', async () => {
    const view = await save();
    await service.start({ id: view.id });
    children[0].stdout!.emit('data', 'x'.repeat(30_000));
    children[0].stderr!.emit('data', 'last failure');
    await vi.waitFor(
      async () =>
        expect(snapshot(await service.list()).runtimes[0]).toMatchObject({
          status: 'error',
          errorCode: 'startup-timeout',
        }),
      { interval: 5 },
    );
    const runtime = snapshot(await service.list()).runtimes[0];
    expect(runtime.logs.length).toBeLessThanOrEqual(16_384);
    expect(runtime.logs.endsWith('last failure')).toBe(true);
    expect(stop).toHaveBeenCalledWith(children[0]);
  });

  it('handles spawn errors and unexpected exits, retaining logs and allowing retry', async () => {
    const view = await save();
    await service.start({ id: view.id });
    children[0].emit('error', new Error('cannot spawn'));
    expect(snapshot(await service.list()).runtimes[0]).toMatchObject({
      status: 'error',
      errorCode: 'start-failed',
    });
    await service.start({ id: view.id });
    expect(spawn).toHaveBeenCalledTimes(2);
    children[1].emit('exit', 2, null);
    const runtime = snapshot(await service.list()).runtimes[0];
    expect(runtime).toMatchObject({ status: 'error', errorCode: 'server-exited' });
    expect(runtime.url).toBeUndefined();
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('stop cancels an in-flight readiness result, and edit/delete/quit stop owned processes', async () => {
    let ready!: (value: boolean) => void;
    probe.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          ready = resolve;
        }),
    );
    const view = await save();
    await service.start({ id: view.id });
    await service.stop({ id: view.id });
    ready(true);
    expect(snapshot(await service.list()).runtimes[0].status).toBe('stopped');
    await service.start({ id: view.id });
    await service.save({ ...view, command: 'node other.js' });
    expect(stop).toHaveBeenCalledTimes(2);
    await service.start({ id: view.id });
    await service.remove({ id: view.id });
    expect(stop).toHaveBeenCalledTimes(3);
    expect(snapshot(await service.list()).views).toEqual([]);
    const next = await save();
    await service.start({ id: next.id });
    await service.dispose();
    expect(stop).toHaveBeenCalledTimes(4);
    expect(await service.start({ id: next.id })).toMatchObject({ success: false });
  });

  it('quit prevents an in-flight port check from spawning a new server', async () => {
    const view = await save();
    let resolvePort!: (value: boolean) => void;
    portAvailable.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePort = resolve;
        }),
    );
    const starting = service.start({ id: view.id });
    await vi.waitFor(() => expect(resolvePort).toBeTypeOf('function'), { interval: 5 });
    const quitting = service.dispose();
    resolvePort(true);
    await Promise.all([starting, quitting]);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('keeps the process handle after failed cleanup so stop can retry', async () => {
    const view = await save();
    await service.start({ id: view.id });
    stop.mockRejectedValueOnce(new Error('kill failed'));
    expect(await service.remove({ id: view.id })).toMatchObject({ success: false });
    expect(snapshot(await service.list()).views).toHaveLength(1);
    expect(snapshot(await service.stop({ id: view.id })).runtimes[0].status).toBe('stopped');
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('finishes the other process stops before reporting a quit cleanup failure', async () => {
    await save();
    await service.save({ ...input, port: 39124 });
    const owned = new CustomViewsService(file, { spawn, stop, portAvailable, probe });
    for (const view of snapshot(await owned.list()).views) await owned.start({ id: view.id });
    let finishSecond!: () => void;
    stop.mockRejectedValueOnce(new Error('kill failed'));
    stop.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSecond = resolve;
        }),
    );
    const settled = vi.fn();
    const quitting = owned.dispose().catch(settled);
    await vi.waitFor(() => expect(finishSecond).toBeTypeOf('function'), { interval: 5 });
    expect(settled).not.toHaveBeenCalled();
    finishSecond();
    await quitting;
    expect(settled).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
