import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MAX_LOG_SIZE = 10 * 1024 * 1024;
const LOG_PATH = '/user-data/logs/console-output.log';

const mocks = vi.hoisted(() => ({
  files: new Map<string, Buffer>(),
  descriptors: new Map<number, string>(),
  nextFd: 10,
  failRename: false,
  failWrite: false,
  beforeQuit: undefined as (() => void) | undefined,
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/user-data',
    on: (_event: string, callback: () => void) => {
      mocks.beforeQuit = callback;
    },
  },
}));

vi.mock('fs', () => {
  const fsMock = {
    existsSync: vi.fn((filePath: string) => mocks.files.has(filePath)),
    mkdirSync: vi.fn(),
    openSync: vi.fn((filePath: string, flags: string) => {
      if (flags === 'w' || !mocks.files.has(filePath)) {
        mocks.files.set(filePath, Buffer.alloc(0));
      }
      const fd = mocks.nextFd++;
      mocks.descriptors.set(fd, filePath);
      return fd;
    }),
    fstatSync: vi.fn((fd: number) => ({
      size: mocks.files.get(mocks.descriptors.get(fd)!)!.length,
    })),
    closeSync: vi.fn((fd: number) => {
      mocks.descriptors.delete(fd);
    }),
    readSync: vi.fn(
      (fd: number, target: Uint8Array, offset: number, length: number, position: number) => {
        const filePath = mocks.descriptors.get(fd);
        if (!filePath) throw new Error('bad descriptor');
        const source = mocks.files.get(filePath)!;
        const bytesRead = Math.min(length, source.length - position);
        source.copy(target, offset, position, position + bytesRead);
        return bytesRead;
      },
    ),
    writeSync: vi.fn((fd: number, bytes: Uint8Array) => {
      if (mocks.failWrite) throw new Error('write failed');
      const filePath = mocks.descriptors.get(fd);
      if (!filePath) throw new Error('bad descriptor');
      const next = Buffer.from(bytes);
      mocks.files.set(filePath, Buffer.concat([mocks.files.get(filePath)!, next]));
      return next.length;
    }),
    ftruncateSync: vi.fn((fd: number, size: number) => {
      const filePath = mocks.descriptors.get(fd)!;
      mocks.files.set(filePath, mocks.files.get(filePath)!.subarray(0, size));
    }),
    unlinkSync: vi.fn((filePath: string) => mocks.files.delete(filePath)),
    renameSync: vi.fn((from: string, to: string) => {
      if (mocks.failRename) throw new Error('rename failed');
      mocks.files.set(to, mocks.files.get(from)!);
      mocks.files.delete(from);
    }),
  };
  return { ...fsMock, default: fsMock };
});

const realStdoutWrite = process.stdout.write;
const realStderrWrite = process.stderr.write;
let forwardedStdout: ReturnType<typeof vi.fn>;
let forwardedStderr: ReturnType<typeof vi.fn>;
let priorStdoutErrorListeners: Function[];
let priorStderrErrorListeners: Function[];

async function setupCapture(): Promise<void> {
  const { setupConsoleLogCapture } = await import('../logging/console-log-capture');
  setupConsoleLogCapture();
}

function closedStreamError(code: string): Error & { code: string } {
  return Object.assign(new Error('stream is closed'), { code });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.files.clear();
  mocks.descriptors.clear();
  mocks.nextFd = 10;
  mocks.failRename = false;
  mocks.failWrite = false;
  mocks.beforeQuit = undefined;
  forwardedStdout = vi.fn(() => true);
  forwardedStderr = vi.fn(() => true);
  process.stdout.write = forwardedStdout as typeof process.stdout.write;
  process.stderr.write = forwardedStderr as typeof process.stderr.write;
  priorStdoutErrorListeners = process.stdout.listeners('error');
  priorStderrErrorListeners = process.stderr.listeners('error');
});

afterEach(() => {
  mocks.beforeQuit?.();
  process.stdout.write = realStdoutWrite;
  process.stderr.write = realStderrWrite;
  // Each module reset re-imports the logger, which re-protects the real
  // streams; drop the listeners added during the test to avoid buildup.
  for (const listener of process.stdout.listeners('error')) {
    if (!priorStdoutErrorListeners.includes(listener)) {
      process.stdout.removeListener('error', listener as (...args: unknown[]) => void);
    }
  }
  for (const listener of process.stderr.listeners('error')) {
    if (!priorStderrErrorListeners.includes(listener)) {
      process.stderr.removeListener('error', listener as (...args: unknown[]) => void);
    }
  }
});

describe('console log capture limits', () => {
  it('keeps the newest UTF-8-safe tail of an oversized existing log at startup', async () => {
    const newestTail = Buffer.concat([
      Buffer.alloc(MAX_LOG_SIZE - Buffer.byteLength('newest crash tail') - 1, 'n'),
      Buffer.from('newest crash tail'),
    ]);
    mocks.files.set(LOG_PATH, Buffer.concat([Buffer.from('old€'), newestTail]));

    await setupCapture();

    const rotated = mocks.files.get(LOG_PATH + '.1')!;
    expect(rotated.equals(newestTail)).toBe(true);
    expect(rotated.length).toBeLessThanOrEqual(MAX_LOG_SIZE);
    expect(mocks.files.get(LOG_PATH)!.toString()).toContain('Session started');
    expect(mocks.files.get(LOG_PATH)!.length).toBeLessThanOrEqual(MAX_LOG_SIZE);
  });

  it('rotates before crossing the limit and continues on the new descriptor', async () => {
    mocks.files.set(LOG_PATH, Buffer.alloc(MAX_LOG_SIZE - 80, 'a'));
    await setupCapture();

    process.stdout.write('crossing-threshold'.repeat(4));
    process.stderr.write('continued');

    expect(mocks.files.get(LOG_PATH + '.1')!.length).toBeLessThanOrEqual(MAX_LOG_SIZE);
    expect(mocks.files.get(LOG_PATH)!.toString()).toBe(
      'crossing-threshold'.repeat(4) + 'continued',
    );
    expect(forwardedStdout).toHaveBeenCalledOnce();
    expect(forwardedStderr).toHaveBeenCalledOnce();
  });

  it('keeps only the newest limit-sized tail of one oversized chunk', async () => {
    await setupCapture();
    const oversized = 'a'.repeat(123) + 'b'.repeat(MAX_LOG_SIZE);

    process.stdout.write(oversized);

    const active = mocks.files.get(LOG_PATH)!;
    expect(mocks.files.get(LOG_PATH + '.1')!.length).toBeLessThanOrEqual(MAX_LOG_SIZE);
    expect(active.length).toBe(MAX_LOG_SIZE);
    expect(active[0]).toBe('b'.charCodeAt(0));
    expect(active[active.length - 1]).toBe('b'.charCodeAt(0));
    expect(active.indexOf('a'.charCodeAt(0))).toBe(-1);
  });

  it('skips a write after rotation fails without writing to captured streams', async () => {
    await setupCapture();
    const beforeFailure = Buffer.from(mocks.files.get(LOG_PATH)!);
    mocks.failRename = true;

    process.stdout.write('x'.repeat(MAX_LOG_SIZE));

    expect(mocks.files.get(LOG_PATH)).toEqual(beforeFailure);
    expect(forwardedStdout).toHaveBeenCalledOnce();
    expect(forwardedStderr).not.toHaveBeenCalled();
  });

  it('disables capture after a write failure while forwarding later output', async () => {
    await setupCapture();
    const beforeFailure = Buffer.from(mocks.files.get(LOG_PATH)!);
    mocks.failWrite = true;

    process.stderr.write('failed');
    mocks.failWrite = false;
    process.stderr.write('still forwarded');

    expect(mocks.files.get(LOG_PATH)).toEqual(beforeFailure);
    expect(forwardedStderr).toHaveBeenCalledTimes(2);
    expect(forwardedStdout).not.toHaveBeenCalled();
  });
});

describe('broken stream containment (monorepo#3152)', () => {
  it('contains a synchronous EPIPE, stops forwarding, and keeps capturing to file', async () => {
    await setupCapture();
    forwardedStderr.mockImplementationOnce(() => {
      throw closedStreamError('EPIPE');
    });

    const firstCallback = vi.fn();
    expect(() => process.stderr.write('first', firstCallback)).not.toThrow();
    const secondCallback = vi.fn();
    expect(process.stderr.write('second', 'utf8', secondCallback)).toBe(true);

    // Completion callbacks are invoked asynchronously, per the stream API.
    expect(firstCallback).not.toHaveBeenCalled();
    expect(secondCallback).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => process.nextTick(resolve));
    expect(firstCallback).toHaveBeenCalledWith();
    expect(secondCallback).toHaveBeenCalledWith();

    expect(forwardedStderr).toHaveBeenCalledTimes(1);
    const captured = mocks.files.get(LOG_PATH)!.toString();
    expect(captured).toContain('first');
    expect(captured).toContain('second');

    process.stdout.write('stdout unaffected');
    expect(forwardedStdout).toHaveBeenCalledOnce();
  });

  it('stops forwarding after an async closed-pipe error event without an uncaughtException', async () => {
    await setupCapture();

    expect(() => process.stderr.emit('error', closedStreamError('EPIPE'))).not.toThrow();
    process.stderr.write('after async failure');

    expect(forwardedStderr).not.toHaveBeenCalled();
    expect(mocks.files.get(LOG_PATH)!.toString()).toContain('after async failure');
  });

  it('rethrows non-closed-stream write failures and keeps the stream forwarding', async () => {
    await setupCapture();
    const unrelated = new Error('disk quota exceeded');
    forwardedStdout.mockImplementationOnce(() => {
      throw unrelated;
    });

    expect(() => process.stdout.write('boom')).toThrow(unrelated);
    process.stdout.write('still forwarded');
    expect(forwardedStdout).toHaveBeenCalledTimes(2);
  });

  it('bounds the log under sustained write pressure while the stream is broken', async () => {
    await setupCapture();
    process.stderr.emit('error', closedStreamError('EPIPE'));

    for (let i = 0; i < 12; i++) {
      process.stderr.write('x'.repeat(1024 * 1024));
    }

    expect(forwardedStderr).not.toHaveBeenCalled();
    expect(mocks.files.get(LOG_PATH)!.length).toBeLessThanOrEqual(MAX_LOG_SIZE);
    expect(mocks.files.get(LOG_PATH + '.1')!.length).toBeLessThanOrEqual(MAX_LOG_SIZE);
  });
});
