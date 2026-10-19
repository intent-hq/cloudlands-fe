import type { NonSharedBuffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MAX_BYTES = 128 * 1024 * 1024;
const jobs = new Map<
  string,
  { controller: AbortController; result: Promise<NonSharedBuffer>; users: number }
>();

async function transcode(bytes: Buffer, signal: AbortSignal): Promise<NonSharedBuffer> {
  const directory = await mkdtemp(path.join(tmpdir(), 'intent-video-preview-'));
  const source = path.join(directory, 'source.mp4');
  const output = path.join(directory, 'preview.mp4');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  let sizeCheck: ReturnType<typeof setInterval> | undefined;
  try {
    signal.throwIfAborted();
    await writeFile(source, bytes, { mode: 0o600, signal });
    signal.throwIfAborted();
    // Bound disk growth as well as the bytes returned to the renderer.
    sizeCheck = setInterval(() => {
      void stat(output)
        .then((info) => {
          if (info.size > MAX_BYTES) controller.abort();
        })
        .catch(() => {});
    }, 250);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        '/usr/bin/avconvert',
        ['--source', source, '--output', output, '--preset', 'Preset1920x1080'],
        { stdio: 'ignore' },
      );
      const kill = () => {
        child.kill('SIGKILL');
      };
      const timeout = setTimeout(() => controller.abort(), 30_000);
      controller.signal.addEventListener('abort', kill, { once: true });
      let spawnError: Error | undefined;
      child.on('error', (error) => {
        spawnError = error;
      });
      // Abort errors may precede process exit. Wait for close before removing its files.
      child.on('close', (code) => {
        clearTimeout(timeout);
        controller.signal.removeEventListener('abort', kill);
        if (spawnError || controller.signal.aborted || code !== 0) {
          reject(spawnError ?? new Error('Video conversion failed'));
        } else resolve();
      });
      if (controller.signal.aborted) kill();
    });
    signal.throwIfAborted();
    const info = await stat(output);
    if (info.size === 0 || info.size > MAX_BYTES) throw new Error('Invalid video preview size');
    return await readFile(output, { signal });
  } finally {
    clearInterval(sizeCheck);
    signal.removeEventListener('abort', abort);
    await rm(directory, { recursive: true, force: true });
  }
}

/** Temporary H.264 preview only. Never modifies a workspace file or caches stale source bytes. */
export async function createVideoPreview(
  bytes: Buffer,
  identity: string,
  signal: AbortSignal,
): Promise<NonSharedBuffer> {
  signal.throwIfAborted();
  if (process.platform !== 'darwin' || bytes.length > MAX_BYTES)
    throw new Error('Video conversion unavailable');
  // Backend/path isolation plus content identity: a same-sized edit cannot reuse an old preview.
  const key = JSON.stringify([identity, createHash('sha256').update(bytes).digest('hex')]);
  let job = jobs.get(key);
  if (!job) {
    if (jobs.size >= 2) throw new Error('Video preview capacity reached');
    const controller = new AbortController();
    const result = transcode(bytes, controller.signal).finally(() => jobs.delete(key));
    job = { controller, result, users: 0 };
    jobs.set(key, job);
  }
  const active = job;
  active.users++;
  return await new Promise<NonSharedBuffer>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    active.result.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  }).finally(() => {
    active.users--;
    if (active.users === 0) active.controller.abort();
  });
}
