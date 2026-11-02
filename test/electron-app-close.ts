import type { ChildProcess } from 'node:child_process';
import { _electron as electron, test, type ElectronApplication } from '@playwright/test';

type ClosableApp = { close(): Promise<void>; process(): ChildProcess };

// `ElectronApplication.process()` throws once the app is disposed, so the
// fixture records each child at launch for a later (possibly repeated) close.
const launchedProcesses = new WeakMap<object, ChildProcess>();

function processOf(app: ClosableApp) {
  return launchedProcesses.get(app) ?? app.process();
}

function hasExited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null;
}

/**
 * Close an Electron fixture app and guarantee its process is gone afterwards.
 * `ElectronApplication.close()` waits on the app's own quit path; a renderer or
 * main process wedged mid-test (crash/reopen fixtures, a timed-out test) can
 * hold it past Playwright's worker teardown budget. After `timeoutMs` the
 * process is killed instead, and the call resolves once it has exited.
 */
export async function closeElectronApp(
  app: ClosableApp,
  { timeoutMs = 10_000 }: { timeoutMs?: number } = {},
): Promise<'closed' | 'killed'> {
  const child = processOf(app);
  const exited = hasExited(child)
    ? Promise.resolve()
    : new Promise<void>((done) => child.once('exit', () => done()));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    app.close().then(
      () => 'closed' as const,
      () => 'failed' as const,
    ),
    new Promise<'timeout'>((done) => {
      timer = setTimeout(() => done('timeout'), timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  if (outcome === 'closed' && hasExited(child)) return 'closed';
  if (!hasExited(child)) child.kill('SIGKILL');
  await exited;
  return outcome === 'closed' ? 'closed' : 'killed';
}

/**
 * `test` with a `launchElectron` fixture whose apps are closed (or killed) in
 * fixture teardown. Unlike a `finally` block, fixture teardown also runs when
 * the test times out while awaiting the app.
 */
export const electronTest = test.extend<{
  launchElectron: (options: Parameters<typeof electron.launch>[0]) => Promise<ElectronApplication>;
}>({
  launchElectron: async ({}, use) => {
    const apps: ElectronApplication[] = [];
    await use(async (options) => {
      const app = await electron.launch(options);
      launchedProcesses.set(app, app.process());
      apps.push(app);
      return app;
    });
    await Promise.all(apps.map((app) => closeElectronApp(app)));
  },
});
