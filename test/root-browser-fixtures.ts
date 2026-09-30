import { test as base, type Browser, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

async function observeRootBrowser(browser: Pick<Browser, 'newBrowserCDPSession'>) {
  const session = await browser.newBrowserCDPSession();
  let firstError: unknown;
  try {
    const runtime = await session.send('Browser.getVersion');
    const command = await session.send('Browser.getBrowserCommandLine');
    return { runtime, arguments: command.arguments };
  } catch (error) {
    firstError = error;
    throw error;
  } finally {
    try {
      await session.detach();
    } catch (error) {
      if (firstError) {
        throw new AggregateError(
          [firstError, error],
          'Root runtime observation and detach failed',
          {
            cause: firstError,
          },
        );
      }
      throw error;
    }
  }
}

function fileIdentity(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile()) throw new Error(`Runtime input is not a regular file: ${path}`);
    const sha256 = createHash('sha256').update(readFileSync(fd)).digest('hex');
    const after = fstatSync(fd);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) {
      throw new Error(`Runtime input changed while read: ${path}`);
    }
    return { path, sha256, size: after.size, device: after.dev, inode: after.ino };
  } finally {
    closeSync(fd);
  }
}

function rootBrowserPlan(headless: boolean) {
  const testPackage = require.resolve('@playwright/test/package.json');
  const fromTest = createRequire(testPackage);
  const runnerPackage = fromTest.resolve('playwright/package.json');
  const fromRunner = createRequire(runnerPackage);
  const corePackage = fromRunner.resolve('playwright-core/package.json');
  const core = JSON.parse(readFileSync(corePackage, 'utf8')) as { version: string };
  const { registry } = fromRunner('playwright-core/lib/coreBundle').registry;
  const executable = registry.findExecutable(headless ? 'chromium-headless-shell' : 'chromium');
  return {
    runnerVersion: core.version,
    browserVersion: executable.browserVersion as string,
    executablePath: executable.executablePath() as string,
    packages: [testPackage, runnerPackage, corePackage].map(fileIdentity),
  };
}

type Observation = Awaited<ReturnType<typeof observeRootBrowser>>;
type Plan = ReturnType<typeof rootBrowserPlan>;

function assertRootRuntime(observation: Observation, plan: Plan) {
  const products = [`Chrome/${plan.browserVersion}`, `HeadlessChrome/${plan.browserVersion}`];
  if (!products.includes(observation.runtime.product)) {
    throw new Error(`Unexpected root Chromium runtime: ${observation.runtime.product}`);
  }
  if (observation.arguments[0] !== plan.executablePath) {
    throw new Error('Root Chromium command line does not identify the selected executable');
  }
}

type Identity = {
  observation: Observation;
  plan: Plan;
  executable: ReturnType<typeof fileIdentity>;
  source: { head: string; status: string; files: ReturnType<typeof fileIdentity>[] };
};

async function attachRootRuntime(
  identity: Identity,
  use: () => Promise<void>,
  testInfo: Pick<TestInfo, 'attach' | 'retry' | 'workerIndex' | 'titlePath'>,
) {
  await testInfo.attach('root-runtime.json', {
    contentType: 'application/json',
    body: JSON.stringify(
      {
        ...identity,
        retry: testInfo.retry,
        workerIndex: testInfo.workerIndex,
        test: testInfo.titlePath,
      },
      null,
      2,
    ),
  });
  assertRootRuntime(identity.observation, identity.plan);
  await use();
}

export const test = base.extend<{ _rootRuntimeEvidence: void }, { _rootRuntimeIdentity: Identity }>(
  {
    _rootRuntimeIdentity: [
      async ({ browser, browserName, headless, channel, connectOptions, launchOptions }, use) => {
        if (
          browserName !== 'chromium' ||
          channel ||
          connectOptions ||
          launchOptions.executablePath
        ) {
          throw new Error('Root runtime evidence requires the unchanged local Chromium selection');
        }
        const observation = await observeRootBrowser(browser);
        const plan = rootBrowserPlan(headless);
        const git = (...args: string[]) =>
          execFileSync('git', args, {
            cwd: root,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          }).trim();
        const files = [
          'package.json',
          'pnpm-lock.yaml',
          'playwright.config.ts',
          'test/root-browser-fixtures.ts',
          'test/chat-polish-controls.spec.ts',
          'test/resource-icon-tile.spec.ts',
        ].map((file) => fileIdentity(resolve(root, file)));
        await use({
          observation,
          plan,
          executable: fileIdentity(plan.executablePath),
          source: { head: git('rev-parse', 'HEAD'), status: git('status', '--porcelain'), files },
        });
      },
      { scope: 'worker' },
    ],
    _rootRuntimeEvidence: [
      async ({ _rootRuntimeIdentity }, use, testInfo) => {
        await attachRootRuntime(_rootRuntimeIdentity, use, testInfo);
      },
      { auto: true, box: true },
    ],
  },
);
