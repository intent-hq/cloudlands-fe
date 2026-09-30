// @verify-changed-triggers: e2e/build-smoke-helpers.ts
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ launch: vi.fn(), observe: vi.fn() }));
vi.mock('@playwright/test', () => ({ _electron: { launch: mocks.launch } }));
vi.mock('child_process', () => {
  const api = { execFileSync: mocks.observe, execSync: vi.fn() };
  return { ...api, default: api };
});
import { launchPackagedApp } from '../e2e/build-smoke-helpers';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it.each(['evaluate', 'profile', 'firstWindow', 'splash', 'observation', 'close'])(
  'settles its owned handle when post-launch %s fails, preserving primary and cleanup',
  async (stage) => {
    const root = mkdtempSync(join(tmpdir(), 'launch-fake-'));
    roots.push(root);
    const binary = join(root, 'inert-file');
    writeFileSync(binary, 'not executable');
    vi.stubEnv('PACKAGED_APP_PATH', binary);
    const primary = new Error('setup failed');
    const secondary = new Error('cleanup failed');
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
        if (stage === 'close') throw secondary;
      }),
      evaluate: vi.fn(),
      firstWindow: vi.fn(async () => {
        if (stage === 'firstWindow') throw primary;
        return {
          on: vi.fn(),
          waitForFunction: vi.fn(async () => {
            throw primary;
          }),
        };
      }),
    };
    mocks.launch.mockImplementation(async (options) => {
      const profile = options.env.INTENTD_DATA_DIR.slice(0, -'/intentd'.length);
      roots.push(profile);
      app.evaluate.mockImplementation(async () => {
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
    const error = await launchPackagedApp().catch((error) => error);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(app.close).toHaveBeenCalledOnce();
    expect(proc.exitCode).toBe(0);
    if (stage === 'observation' || stage === 'close') {
      expect(error).toBeInstanceOf(AggregateError);
      expect(error.errors).toEqual([primary, secondary]);
    } else if (stage === 'profile') {
      expect(error.message).toContain('runtime identity mismatch');
    } else expect(error).toBe(primary);
  },
);
