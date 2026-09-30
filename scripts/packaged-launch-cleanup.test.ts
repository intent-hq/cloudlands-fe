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
  'worktree-boundary',
  'worktree-missing-home',
  'worktree-root-mismatch',
  'worktree-platform-home',
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
  'quit-race',
  'exit-zero',
  'exit-nonzero',
  'exit-signal',
  'exit-unknown',
  'exit-nonzero-receipt',
  'log-after-handoff-exit-nonzero',
])(
  'settles its owned handle when post-launch %s fails, preserving primary and cleanup',
  async (stage) => {
    const root = mkdtempSync(join(tmpdir(), 'launch-fake-'));
    roots.push(root);
    const binary = join(root, 'inert-file');
    writeFileSync(binary, 'not executable');
    vi.stubEnv('PACKAGED_APP_PATH', binary);
    if (stage.startsWith('worktree-')) {
      vi.stubEnv('BUILD_SMOKE_WORKSPACES_ROOT', join(root, 'home/intent/workspaces'));
      vi.stubEnv('HOME', join(root, 'home'));
      vi.stubEnv('INTENTD_WORKSPACES_DIR', join(root, 'home/intent/workspaces'));
    }
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
    const electronApp = Object.assign(new EventEmitter(), {
      isPackaged: true,
      getPath: vi.fn(),
      getAppPath: () => '/synthetic/app.asar',
    });
    let gracefulCleanupCompleted = false;
    const proc = Object.assign(new EventEmitter(), {
      pid: 987654,
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      stdout: null,
      stderr: null,
      kill: vi.fn(() => {
        const finish = () => {
          gracefulCleanupCompleted = true;
          proc.exitCode = stage.includes('exit-nonzero')
            ? 1
            : stage === 'exit-signal' || stage === 'exit-unknown'
              ? null
              : 0;
          proc.signalCode = stage === 'exit-signal' ? 'SIGTERM' : null;
          proc.emit('close', proc.exitCode, proc.signalCode);
        };
        if (stage === 'quit-race') setImmediate(finish);
        else finish();
        return true;
      }),
    });
    const app = {
      process: () => proc,
      close: vi.fn(async () => {
        if (stage.includes('close')) throw secondary;
        if (stage === 'quit-race') {
          const event = { preventDefault: vi.fn() };
          electronApp.emit('before-quit', event);
          expect(gracefulCleanupCompleted).toBe(false);
          expect(event.preventDefault).toHaveBeenCalledOnce();
        }
      }),
      evaluate: vi.fn(),
      firstWindow: vi.fn(async () => {
        if (stage === 'firstWindow') throw primary;
        return {
          on: vi.fn(),
          waitForFunction: vi.fn(async () => {
            if (stage.startsWith('log-after-handoff') || stage.startsWith('exit-')) return;
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
      app.evaluate.mockImplementation(async (callback) => {
        if (stage === 'worktree-platform-home') {
          electronApp.getPath.mockImplementation((name) =>
            name === 'home' ? '/platform/account' : join(profile, 'electron'),
          );
          vi.stubEnv('INTENTD_DATA_DIR', options.env.INTENTD_DATA_DIR);
          const runtime = callback({ app: electronApp });
          expect(runtime.home).toBe('/platform/account');
          expect(runtime.environmentHome).toBe(join(root, 'home'));
          return runtime;
        }
        if (stage === 'quit-race') {
          electronApp.getPath.mockReturnValue(join(profile, 'electron'));
          return { ...callback({ app: electronApp }), dataDir: options.env.INTENTD_DATA_DIR };
        }
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
          home: '/wrong/account',
          environmentHome:
            stage === 'worktree-missing-home'
              ? undefined
              : stage === 'worktree-boundary'
                ? '/wrong/account'
                : options.env.HOME,
          workspacesRoot:
            stage === 'worktree-root-mismatch'
              ? '/outside/workspaces'
              : process.env.BUILD_SMOKE_WORKSPACES_ROOT,
        };
      });
      return app;
    });
    let error = await launchPackagedApp().catch((error) => error);
    if (stage.startsWith('log-after-handoff')) {
      logStream.emit('error', primary);
      error = await exitPackagedApp(error.app).catch((error) => error);
    }
    if (stage.startsWith('exit-')) {
      const ownedApp = error.app;
      error = await exitPackagedApp(ownedApp).catch((error) => error);
      // Repeated teardown preserves the original success or rejection.
      expect(await exitPackagedApp(ownedApp).catch((error) => error)).toBe(error);
    }
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(app.close).toHaveBeenCalledOnce();
    expect(proc.exitCode).toBe(
      stage.includes('exit-nonzero')
        ? 1
        : stage === 'exit-signal' || stage === 'exit-unknown'
          ? null
          : 0,
    );
    expect(gracefulCleanupCompleted).toBe(true);
    if (stage.startsWith('exit-') || stage === 'log-after-handoff-exit-nonzero') {
      expect(receipt.exitCode).toBe(proc.exitCode);
      expect(receipt.signalCode).toBe(proc.signalCode);
      expect(receipt.settled).toBe(true);
      if (stage === 'exit-zero') {
        expect(error).toBeUndefined();
        expect(receipt.error).toBeNull();
      } else {
        const flatten = (value: any): any[] =>
          value instanceof AggregateError ? value.errors.flatMap(flatten) : [value];
        const errors = flatten(error);
        const exitError = errors.find((value) => String(value).includes('unsuccessful exit'));
        expect(exitError).toBeInstanceOf(Error);
        expect(receipt.cleanupError).toBe(String(exitError));
        expect(errors).toEqual([
          ...(stage.startsWith('log-after-handoff') ? [primary] : []),
          exitError,
          ...(stage.includes('receipt') ? [recording] : []),
        ]);
      }
    } else if (stage.startsWith('log-after-handoff') && stage !== 'log-after-handoff') {
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
    } else if (stage.startsWith('worktree-') && stage !== 'worktree-platform-home') {
      expect(error.message).toContain('worktree boundary mismatch');
    } else expect(error).toBe(primary);
  },
);
