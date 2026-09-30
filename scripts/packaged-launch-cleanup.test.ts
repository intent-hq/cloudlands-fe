// @verify-changed-triggers: e2e/build-smoke-helpers.ts
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  observe: vi.fn(),
  logStream: vi.fn(),
  write: vi.fn(),
}));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const api = {
    ...actual,
    createWriteStream: mocks.logStream,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      mocks.write(...args);
      return actual.writeFileSync(...args);
    },
  };
  return { ...api, default: api };
});
vi.mock('@playwright/test', () => ({ _electron: { launch: mocks.launch } }));
vi.mock('child_process', () => {
  const api = { execFileSync: mocks.observe, execSync: vi.fn() };
  return { ...api, default: api };
});
import { exitPackagedApp, launchPackagedApp } from '../e2e/build-smoke-helpers';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it.each([
  'evaluate',
  'profile',
  'firstWindow',
  'splash',
  'observation',
  'close',
  'log-open',
  'log-write',
  'log-after-handoff',
  'log-after-handoff-close',
  'log-after-handoff-receipt',
  'log-after-handoff-close-receipt',
])(
  'settles its owned handle when post-launch %s fails, preserving primary and cleanup',
  async (stage) => {
    const root = mkdtempSync(join(tmpdir(), 'launch-fake-'));
    roots.push(root);
    const binary = join(root, 'inert-file');
    writeFileSync(binary, 'not executable');
    vi.stubEnv('PACKAGED_APP_PATH', binary);
    const primary = new Error('setup failed');
    const secondary = new Error('cleanup failed');
    const recording = new Error('receipt failed');
    let receipt: any;
    mocks.write.mockImplementation((file, data) => {
      if (String(file).includes('/shutdown-')) {
        receipt = JSON.parse(String(data));
        if (stage.includes('receipt')) throw recording;
      }
    });
    const logStream = Object.assign(new EventEmitter(), {
      end: vi.fn(() => logStream.emit('close')),
    });
    mocks.logStream.mockImplementation(() => {
      queueMicrotask(() => logStream.emit(stage === 'log-open' ? 'error' : 'open', primary));
      return logStream;
    });
    mocks.observe.mockImplementation(() => {
      if (stage === 'observation') throw secondary;
      throw Object.assign(new Error('no children'), { status: 1 });
    });
    const proc = Object.assign(new EventEmitter(), {
      pid: 987654,
      exitCode: null as number | null,
      signalCode: null,
      stdout: null,
      stderr: null,
      kill: vi.fn(() => {
        proc.exitCode = 0;
        proc.emit('close', 0);
        return true;
      }),
    });
    const app = {
      process: () => proc,
      close: vi.fn(async () => {
        if (stage.includes('close')) throw secondary;
      }),
      evaluate: vi.fn(),
      firstWindow: vi.fn(async () => {
        if (stage === 'firstWindow') throw primary;
        return {
          on: vi.fn(),
          waitForFunction: vi.fn(async () => {
            if (stage.startsWith('log-after-handoff')) return;
            throw primary;
          }),
          waitForTimeout: vi.fn(async () => undefined),
          locator: () => ({ first: () => ({ isVisible: async () => false }) }),
        };
      }),
    };
    mocks.launch.mockImplementation(async (options) => {
      const profile = options.env.INTENTD_DATA_DIR.slice(0, -'/intentd'.length);
      roots.push(profile);
      app.evaluate.mockImplementation(async () => {
        if (stage === 'log-write') {
          queueMicrotask(() => logStream.emit('error', primary));
          return await new Promise(() => {});
        }
        if (['evaluate', 'observation', 'close'].includes(stage)) throw primary;
        return {
          packaged: true,
          arch: process.arch,
          platform: process.platform,
          userData: stage === 'profile' ? '/wrong/account/profile' : join(profile, 'electron'),
          dataDir: options.env.INTENTD_DATA_DIR,
        };
      });
      return app;
    });
    let error = await launchPackagedApp().catch((error) => error);
    if (stage.startsWith('log-after-handoff')) {
      logStream.emit('error', primary);
      error = await exitPackagedApp(error.app).catch((error) => error);
    }
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(app.close).toHaveBeenCalledOnce();
    expect(proc.exitCode).toBe(0);
    if (stage.startsWith('log-after-handoff') && stage !== 'log-after-handoff') {
      const flatten = (value: any): any[] =>
        value instanceof AggregateError ? value.errors.flatMap(flatten) : [value];
      expect(flatten(error)).toEqual([
        primary,
        ...(stage.includes('close') ? [secondary] : []),
        ...(stage.includes('receipt') ? [recording] : []),
      ]);
      expect(receipt.loggingError).toBe(String(primary));
      expect(receipt.cleanupError).toBe(stage.includes('close') ? String(secondary) : null);
      expect(receipt.logClose).toBe('failed; close unconfirmed');
    } else if (stage === 'observation' || stage === 'close') {
      expect(error).toBeInstanceOf(AggregateError);
      expect(error.errors).toEqual([primary, secondary]);
    } else if (stage === 'profile') {
      expect(error.message).toContain('runtime identity mismatch');
    } else expect(error).toBe(primary);
  },
);
