// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { readFile, writeFile, truncate } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createVideoPreview } from './video-preview';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

describe('temporary video preview conversion', () => {
  const platform = process.platform;
  const children: Array<
    EventEmitter & { kill: ReturnType<typeof vi.fn>; source: string; output: string }
  > = [];
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    vi.mocked(spawn).mockImplementation((_command, args) => {
      const child = Object.assign(new EventEmitter(), {
        kill: vi.fn(() => true),
        source: args![1],
        output: args![3],
      });
      children.push(child);
      return child as unknown as ReturnType<typeof spawn>;
    });
  });
  afterEach(async () => {
    vi.useRealTimers();
    for (const child of children) child.emit('close', null);
    await vi.waitFor(() => {
      for (const child of children) expect(existsSync(path.dirname(child.source))).toBe(false);
    });
    children.length = 0;
    vi.restoreAllMocks();
    vi.mocked(spawn).mockReset();
    Object.defineProperty(process, 'platform', { value: platform });
  });

  it('shares simultaneous identical requests, returns new bytes, and removes private temporary files', async () => {
    const original = Buffer.from('original');
    const first = createVideoPreview(
      original,
      'backend/workspace/video',
      new AbortController().signal,
    );
    const second = createVideoPreview(
      original,
      'backend/workspace/video',
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(children).toHaveLength(1));
    const child = children[0];
    expect(await readFile(child.source)).toEqual(original);
    expect(spawn).toHaveBeenCalledWith(
      '/usr/bin/avconvert',
      ['--source', child.source, '--output', child.output, '--preset', 'Preset1920x1080'],
      { stdio: 'ignore' },
    );
    await writeFile(child.output, 'compatible');
    child.emit('close', 0);
    expect(await first).toEqual(Buffer.from('compatible'));
    expect(await second).toEqual(Buffer.from('compatible'));
    expect(original.toString()).toBe('original');
    expect(existsSync(path.dirname(child.source))).toBe(false);
  });

  it('does not share jobs across backends or source revisions and bounds parallel converters', async () => {
    const first = createVideoPreview(
      Buffer.from('one'),
      'backend-a/ws/file',
      new AbortController().signal,
    );
    const second = createVideoPreview(
      Buffer.from('one'),
      'backend-b/ws/file',
      new AbortController().signal,
    );
    const outcomes = Promise.allSettled([first, second]);
    await vi.waitFor(() => expect(children).toHaveLength(2));
    await expect(
      createVideoPreview(Buffer.from('two'), 'backend-a/ws/file', new AbortController().signal),
    ).rejects.toThrow('capacity');
    children.forEach((child) => child.emit('close', 1));
    expect((await outcomes).every((outcome) => outcome.status === 'rejected')).toBe(true);
    const revised = createVideoPreview(
      Buffer.from('two'),
      'backend-a/ws/file',
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(children).toHaveLength(3));
    expect(await readFile(children[2].source, 'utf8')).toBe('two');
    await writeFile(children[2].output, 'new preview');
    children[2].emit('close', 0);
    expect((await revised).toString()).toBe('new preview');
  });

  it('keeps a shared job alive until its last viewer leaves and waits for exit before cleanup', async () => {
    const a = new AbortController();
    const b = new AbortController();
    const first = createVideoPreview(Buffer.from('clip'), 'file', a.signal);
    const second = createVideoPreview(Buffer.from('clip'), 'file', b.signal);
    const outcomes = Promise.allSettled([first, second]);
    await vi.waitFor(() => expect(children).toHaveLength(1));
    a.abort();
    await expect(first).rejects.toThrow();
    expect(children[0].kill).not.toHaveBeenCalled();
    b.abort();
    await outcomes;
    expect(children[0].kill).toHaveBeenCalledWith('SIGKILL');
    expect(existsSync(children[0].source)).toBe(true);
    children[0].emit('close', null);
    await vi.waitFor(() => expect(existsSync(children[0].source)).toBe(false));
  });

  it('kills timed-out conversions and cleans up after exit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const result = createVideoPreview(Buffer.from('clip'), 'timeout', new AbortController().signal);
    const outcome = Promise.allSettled([result]);
    await vi.waitFor(() => expect(children).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(children[0].kill).toHaveBeenCalledWith('SIGKILL');
    children[0].emit('close', null);
    expect((await outcome)[0].status).toBe('rejected');
  });

  it('rejects unavailable platforms and already-cancelled requests without spawning', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    await expect(
      createVideoPreview(Buffer.from('clip'), 'file', new AbortController().signal),
    ).rejects.toThrow('unavailable');
    await expect(
      createVideoPreview(Buffer.from('clip'), 'file', AbortSignal.abort()),
    ).rejects.toThrow();
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each(['empty', 'oversized', 'spawn failure'])(
    'rejects %s output and cleans temporary data',
    async (failure) => {
      const result = createVideoPreview(Buffer.from('clip'), failure, new AbortController().signal);
      const outcome = Promise.allSettled([result]);
      await vi.waitFor(() => expect(children).toHaveLength(1));
      const child = children[0];
      if (failure === 'spawn failure') child.emit('error', new Error('ENOENT'));
      else {
        await writeFile(child.output, '');
        if (failure === 'oversized') await truncate(child.output, 128 * 1024 * 1024 + 1);
      }
      child.emit('close', failure === 'spawn failure' ? -1 : 0);
      expect((await outcome)[0].status).toBe('rejected');
      expect(existsSync(path.dirname(child.source))).toBe(false);
    },
  );
});
