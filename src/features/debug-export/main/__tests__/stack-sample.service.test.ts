/**
 * Wire-shape tests for the Help menu's "Sample intentd Process..." flow:
 * drives the REAL JsonRpcClient over an in-memory fake socket (the mock BE)
 * and asserts the exact `debug.sampleStacks` request/response contract
 * (PROTOCOL §5.43).
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tempDir: '',
}));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'temp') return mocks.tempDir;
      throw new Error(`unexpected getPath: ${name}`);
    },
  },
}));

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => {
    throw new Error('tests must inject a client');
  },
}));

import { JsonRpcClient } from '../../../backend/main/json-rpc-client';
import { JsonRpcError } from '../../../backend/main/json-rpc-errors';
import {
  SAMPLE_DURATION_MS,
  SAMPLE_FREQUENCY_HZ,
  SAMPLE_TIMEOUT_MS,
  captureStackSample,
  createStackSampleFile,
  shouldShowStackSampleMenuItem,
} from '../stack-sample.service';

/** In-memory fake socket: captures outbound frames, injects daemon responses. */
class FakeSocket extends EventEmitter {
  writes: string[] = [];
  write(data: string): boolean {
    this.writes.push(data);
    return true;
  }
  destroy(): void {}
  receive(chunk: string): void {
    this.emit('data', Buffer.from(chunk));
  }
  open(): void {
    this.emit('connect');
  }
}

function makeClient(): { client: JsonRpcClient; socket: FakeSocket } {
  const socket = new FakeSocket();
  const client = new JsonRpcClient({
    socketFactory: () => socket as unknown as Duplex,
    heartbeatIntervalMs: 0,
  });
  client.start();
  socket.open();
  return { client, socket };
}

/** PROTOCOL §5.43 result fixture. */
const SAMPLE_RESULT = {
  report:
    'intentd stack sample — 87 samples, 5 distinct stacks (5000 ms at 99 Hz, ' +
    'CPU-time sampling: idle/blocked threads accumulate no samples)\n\n' +
    '61 samples — thread "tokio-runtime-w" (id 6154):\n' +
    '    0: intent_services::disk_usage::walk (crates/intent-services/src/disk_usage.rs:118)\n',
  durationMs: 5000,
  frequencyHz: 99,
  sampleCount: 87,
  distinctStacks: 5,
};

describe('stack-sample.service', () => {
  let client: JsonRpcClient;
  let socket: FakeSocket;

  beforeEach(async () => {
    mocks.tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stack-sample-test-'));
    ({ client, socket } = makeClient());
  });

  afterEach(async () => {
    client.dispose();
    await fs.rm(mocks.tempDir, { recursive: true, force: true });
  });

  it('sends the exact §5.43 request frame and returns the parsed result', async () => {
    const promise = captureStackSample(client);
    expect(socket.writes).toHaveLength(1);
    expect(JSON.parse(socket.writes[0])).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'debug.sampleStacks',
      params: { durationMs: SAMPLE_DURATION_MS, frequencyHz: SAMPLE_FREQUENCY_HZ },
    });
    expect(SAMPLE_DURATION_MS).toBeGreaterThanOrEqual(100);
    expect(SAMPLE_DURATION_MS).toBeLessThanOrEqual(10_000);
    expect(SAMPLE_FREQUENCY_HZ).toBeGreaterThanOrEqual(1);
    expect(SAMPLE_FREQUENCY_HZ).toBeLessThanOrEqual(250);
    // The RPC blocks for the whole window — timeout must exceed it.
    expect(SAMPLE_TIMEOUT_MS).toBeGreaterThan(SAMPLE_DURATION_MS);

    socket.receive(`${JSON.stringify({ jsonrpc: '2.0', id: 1, result: SAMPLE_RESULT })}\n`);
    await expect(promise).resolves.toEqual(SAMPLE_RESULT);
  });

  it('writes the report to a temp file and returns its path', async () => {
    const promise = createStackSampleFile(client);
    socket.receive(`${JSON.stringify({ jsonrpc: '2.0', id: 1, result: SAMPLE_RESULT })}\n`);
    const { filePath, sampleCount, distinctStacks } = await promise;

    expect(path.dirname(filePath)).toBe(mocks.tempDir);
    expect(path.basename(filePath)).toMatch(/^intentd-sample-\d+\.txt$/);
    expect(sampleCount).toBe(87);
    expect(distinctStacks).toBe(5);
    await expect(fs.readFile(filePath, 'utf8')).resolves.toBe(SAMPLE_RESULT.report);
  });

  it('treats sampleCount 0 (idle daemon) as success, not an error', async () => {
    const idleResult = {
      report:
        'intentd stack sample — 0 samples, 0 distinct stacks (5000 ms at 99 Hz, ' +
        'CPU-time sampling: idle/blocked threads accumulate no samples)\n\n' +
        'No samples were captured: every thread was idle or blocked for the whole window.\n',
      durationMs: 5000,
      frequencyHz: 99,
      sampleCount: 0,
      distinctStacks: 0,
    };
    const promise = createStackSampleFile(client);
    socket.receive(`${JSON.stringify({ jsonrpc: '2.0', id: 1, result: idleResult })}\n`);
    const { filePath, sampleCount } = await promise;
    expect(sampleCount).toBe(0);
    await expect(fs.readFile(filePath, 'utf8')).resolves.toBe(idleResult.report);
  });

  it('surfaces the §5.43 concurrent-session error and writes no file', async () => {
    const promise = createStackSampleFile(client);
    socket.receive(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32603, message: 'a stack sampling session is already in progress' },
      })}\n`,
    );
    await expect(promise).rejects.toThrowError(JsonRpcError);
    await expect(promise).rejects.toThrow('a stack sampling session is already in progress');
    await expect(fs.readdir(mocks.tempDir)).resolves.toEqual([]);
  });

  it('surfaces the §5.43 unsupported-platform error', async () => {
    const promise = captureStackSample(client);
    socket.receive(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32603, message: 'stack sampling is not supported on this platform' },
      })}\n`,
    );
    await expect(promise).rejects.toThrow('not supported on this platform');
  });

  describe('shouldShowStackSampleMenuItem (#1889 menu gating)', () => {
    it('hides the item on a Windows FE with a same-host (UDS) backend', () => {
      expect(shouldShowStackSampleMenuItem('win32', true)).toBe(false);
    });

    it('keeps the item on a Windows FE with a possibly-remote backend', () => {
      expect(shouldShowStackSampleMenuItem('win32', false)).toBe(true);
    });

    it('keeps the item on non-Windows platforms regardless of backend', () => {
      expect(shouldShowStackSampleMenuItem('darwin', true)).toBe(true);
      expect(shouldShowStackSampleMenuItem('darwin', false)).toBe(true);
      expect(shouldShowStackSampleMenuItem('linux', true)).toBe(true);
      expect(shouldShowStackSampleMenuItem('linux', false)).toBe(true);
    });
  });

  it('removes the partial temp file when the report write fails', async () => {
    const writeSpy = vi.spyOn(fs, 'writeFile').mockImplementation(async (file) => {
      await fs.appendFile(file as string, 'partial');
      throw new Error('ENOSPC: no space left on device');
    });
    try {
      const promise = createStackSampleFile(client);
      socket.receive(`${JSON.stringify({ jsonrpc: '2.0', id: 1, result: SAMPLE_RESULT })}\n`);
      await expect(promise).rejects.toThrow('ENOSPC');
      await expect(fs.readdir(mocks.tempDir)).resolves.toEqual([]);
    } finally {
      writeSpy.mockRestore();
    }
  });
});
