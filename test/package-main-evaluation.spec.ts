/** Real Electron evaluator coverage; never launches Intent or a daemon. */
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluatePackageMain } from '../scripts/evaluate-package-main.mjs';

test.describe.configure({ mode: 'serial' });

// Electron may install its missing binary on first resolution. Resolve that
// prerequisite before the hook's bounded process-lifetime work, just as the
// package verifier receives an already-built executable.
const executablePath = createRequire(import.meta.url)('electron');
if (typeof executablePath !== 'string') throw new Error('Electron executable path is unavailable');

let application: ElectronApplication;
let directory: string;

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'intent-package-evaluation-'));
  const profile = join(directory, 'profile');
  await mkdir(profile);
  await writeFile(
    join(directory, 'observed module #.mjs'),
    `export const state = { value: await Promise.resolve(41), calls: 0 };
     export const failure = new Error('original module failure');
     export async function update(value) {
       state.calls++;
       if (value < 0) throw failure;
       state.value = value;
       return state.value;
     }`,
  );
  await writeFile(
    join(directory, 'main.mjs'),
    `import { app } from 'electron';
     import { state } from './observed module %23.mjs';
     app.setPath('userData', ${JSON.stringify(profile)});
     globalThis.packageEvaluationState = state;`,
  );
  const env = Object.fromEntries(
    ['PATH', 'DISPLAY', 'XAUTHORITY', 'SYSTEMROOT'].flatMap((key) =>
      process.env[key] ? [[key, process.env[key]!]] : [],
    ),
  );
  application = await electron.launch({
    executablePath,
    args: [
      ...(process.platform === 'linux' ? ['--ozone-platform=headless'] : []),
      join(directory, 'main.mjs'),
    ],
    env: {
      ...env,
      HOME: directory,
      XDG_CONFIG_HOME: profile,
      XDG_CACHE_HOME: join(directory, 'cache'),
      TMPDIR: directory,
      DD_TRACE_ENABLED: 'false',
    },
  });
  expect(await application.evaluate(({ app }) => app.whenReady().then(() => app.isReady()))).toBe(
    true,
  );
});

test.afterAll(async ({}, testInfo) => {
  try {
    if (application) {
      const child = application.process();
      const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve({ code: child.exitCode, signal: child.signalCode });
        } else {
          child.once('exit', (code, signal) => resolve({ code, signal }));
        }
      });
      const [, outcome] = await Promise.all([application.close(), exited]);
      await testInfo.attach('original-electron-exit', {
        body: JSON.stringify({ pid: child.pid, ...outcome }),
        contentType: 'application/json',
      });
      expect(outcome).toEqual({ code: 0, signal: null });
    }
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

test('loads the original asynchronous module where plain Electron evaluation rejects imports', async ({}, testInfo) => {
  const inspect = async ({ app }: typeof import('electron'), value: number) => {
    const { pathToFileURL } = await import('node:url');
    const module = await import(pathToFileURL(`${app.getAppPath()}/observed module #.mjs`).href);
    const original = (globalThis as typeof globalThis & { packageEvaluationState: unknown })
      .packageEvaluationState;
    return {
      sameOriginal: module.state === original,
      before: module.state.value,
      result: await module.update(value),
      calls: module.state.calls,
    };
  };
  let originalError: unknown;
  try {
    await application.evaluate(inspect, 42);
  } catch (error) {
    originalError = error;
  }
  expect(originalError).toBeInstanceOf(Error);
  expect(String(originalError)).toContain('A dynamic import callback was not specified');
  const first = await evaluatePackageMain(application, inspect, 42);
  expect(first).toEqual({
    sameOriginal: true,
    before: 41,
    result: 42,
    calls: 1,
  });
  const second = await evaluatePackageMain(application, inspect, 43);
  expect(second).toEqual({
    sameOriginal: true,
    before: 42,
    result: 43,
    calls: 2,
  });
  await testInfo.attach('original-and-corrected-evaluation', {
    body: JSON.stringify({ originalError: String(originalError), first, second }),
    contentType: 'application/json',
  });
});

test('preserves asynchronous module errors and callback return or rejection semantics', async () => {
  const originalFailure = await evaluatePackageMain(application, async ({ app }) => {
    const { pathToFileURL } = await import('node:url');
    const module = await import(pathToFileURL(`${app.getAppPath()}/observed module #.mjs`).href);
    try {
      await module.update(-1);
      return { rejected: false };
    } catch (error) {
      return { rejected: true, sameOriginal: error === module.failure, value: module.state.value };
    }
  });
  expect(originalFailure).toEqual({ rejected: true, sameOriginal: true, value: 43 });
  await expect(
    evaluatePackageMain(application, async ({ app }) => {
      const { pathToFileURL } = await import('node:url');
      const module = await import(pathToFileURL(`${app.getAppPath()}/observed module #.mjs`).href);
      return module.update(-1);
    }),
  ).rejects.toThrow('original module failure');
  await expect(
    evaluatePackageMain(application, () => {
      throw new Error('original synchronous failure');
    }),
  ).rejects.toThrow('original synchronous failure');
  expect(await evaluatePackageMain(application, () => undefined)).toBeUndefined();
  expect(await evaluatePackageMain(application, () => null)).toBeNull();
  expect(await evaluatePackageMain(application, (_electron, value) => value, false)).toBe(false);
});
