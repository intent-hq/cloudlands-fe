import { test as baseTest, expect } from '@playwright/experimental-ct-svelte';
import {
  resolveCtContextReuseMode,
  type CtContextReuseMode,
} from '../../playwright/ct-context-reuse';

/**
 * The shared Playwright CT `test` / `expect` for every `*.ct.spec.ts`.
 *
 * `@playwright/experimental-ct-core` pins `_optionContextReuseMode` to
 * `'when-possible'`: one browser context + page per worker, reset between
 * tests (navigate to `about:blank`, clear cache/cookies/origin storage,
 * navigate back to the CT host). That reset has repeatedly raced the next
 * `mount()`'s `Runtime.callFunctionOn` on the merge queue, surfacing as a
 * pass-on-retry "Execution context was destroyed, most likely because of a
 * navigation" at the `mount(` line: intent-hq/intent#4373, #4783, #5236,
 * #5249, #5279, #5481. This module turns reuse off for the whole suite so
 * every test mounts into a fresh context.
 *
 * Why here and not in `playwright-ct.config.ts` `use`: Playwright applies
 * config `use` overrides right after the fixture list that declares the
 * option tuple (base `@playwright/test`). ct-core re-registers the option as
 * a plain value in a later list, which shadows the config value, so only a
 * `test.extend` re-registration (worker scope, option tuple) or a file-level
 * `test.use` can override it. The value comes from
 * `playwright/ct-context-reuse.ts`: `'none'` by default, `'when-possible'`
 * under `CT_CONTEXT_REUSE=1` (measurement-only escape hatch).
 *
 * Two auto fixtures ride along:
 * - the isolation guard: when the resolved mode is `'none'`, every test's CDP
 *   `browserContextId` must be new to the worker. A page-side marker cannot
 *   tell reuse from isolation (the reset clears origin storage), so the CDP id
 *   is compared instead. A repeat fails the test loudly — typically a
 *   Playwright upgrade that renamed or dropped the private option, or
 *   `PW_TEST_REUSE_CONTEXT` set in the environment — instead of letting the
 *   flake return silently.
 * - the CDP lifecycle recorder: a second CDP session records execution-context
 *   and navigation events from the moment the `page` fixture is ready (so the
 *   `mount()` call is covered) and attaches them as `cdp-lifecycle.json` when
 *   the test fails. It never throws; a recorder problem is reported as a
 *   `cdp-lifecycle-recorder` annotation.
 */

// ct-svelte bundles its own playwright (1.58.x) while the top-level
// `@playwright/test` is newer, so `Page` / `TestInfo` / `CDPSession` are derived
// from ct-svelte's `test` (its last `beforeEach` overload is `(title, hook)`)
// rather than imported from `@playwright/test`, whose types do not unify.
type CtHookArgs = Parameters<Parameters<typeof baseTest.beforeEach>[1]>;
type Page = CtHookArgs[0]['page'];
type TestInfo = CtHookArgs[1];
type CDPSession = Awaited<ReturnType<ReturnType<Page['context']>['newCDPSession']>>;

interface CtHarnessWorkerFixtures {
  _optionContextReuseMode: CtContextReuseMode;
}

interface CtHarnessTestFixtures {
  _ctIsolatedContextGuard: void;
  _ctCdpLifecycleRecorder: void;
}

const browserContextIdsSeenInWorker = new Set<string>();

async function assertFreshBrowserContext(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    const { targetInfo } = await session.send('Target.getTargetInfo');
    const browserContextId = targetInfo.browserContextId ?? '';
    if (browserContextId === '') {
      throw new Error('Target.getTargetInfo did not report a browserContextId');
    }
    if (browserContextIdsSeenInWorker.has(browserContextId)) {
      throw new Error(
        `browser context ${browserContextId} was already used by an earlier test in this worker: ` +
          "the shared CT test module's _optionContextReuseMode: 'none' override is no longer " +
          'disabling ct-core browser-context reuse (src/test/ct-test.ts; ' +
          'intent-hq/intent#4373, #4783, #5236, #5249, #5279, #5481)',
      );
    }
    browserContextIdsSeenInWorker.add(browserContextId);
  } finally {
    await session.detach();
  }
}

interface LifecycleEvent {
  at: string;
  sinceStartMs: number;
  method: string;
  params: unknown;
}

const RECORDED_METHODS = [
  'Runtime.executionContextCreated',
  'Runtime.executionContextDestroyed',
  'Runtime.executionContextsCleared',
  'Page.frameRequestedNavigation',
  'Page.frameNavigated',
  'Page.frameStartedLoading',
  'Page.frameStoppedLoading',
  'Inspector.targetCrashed',
  'Inspector.targetReloadedAfterCrash',
] as const;

const ENABLE_DOMAINS = ['Runtime.enable', 'Page.enable', 'Inspector.enable'] as const;

function summarizeParams(method: string, params: unknown): unknown {
  if (method === 'Page.frameNavigated' && params && typeof params === 'object') {
    const { frame, type } = params as {
      frame?: { id?: string; parentId?: string; url?: string; unreachableUrl?: string };
      type?: string;
    };
    return {
      type,
      frameId: frame?.id,
      parentId: frame?.parentId,
      url: frame?.url,
      unreachableUrl: frame?.unreachableUrl,
    };
  }
  return params;
}

async function startRecorder(
  page: Page,
): Promise<{ session: CDPSession; events: LifecycleEvent[] }> {
  const session = await page.context().newCDPSession(page);
  const startedAt = Date.now();
  const events: LifecycleEvent[] = [];
  for (const method of RECORDED_METHODS) {
    session.on(method as Parameters<CDPSession['on']>[0], (params: unknown) => {
      const now = Date.now();
      events.push({
        at: new Date(now).toISOString(),
        sinceStartMs: now - startedAt,
        method,
        params: summarizeParams(method, params),
      });
    });
  }
  for (const command of ENABLE_DOMAINS) {
    await session.send(command);
  }
  return { session, events };
}

async function attachRecording(testInfo: TestInfo, events: LifecycleEvent[]): Promise<void> {
  if (testInfo.status === testInfo.expectedStatus) return;
  await testInfo.attach('cdp-lifecycle.json', {
    contentType: 'application/json',
    body: JSON.stringify(
      {
        test: testInfo.titlePath,
        status: testInfo.status,
        retry: testInfo.retry,
        workerIndex: testInfo.workerIndex,
        events,
      },
      null,
      2,
    ),
  });
}

function annotateRecorderProblem(testInfo: TestInfo, stage: string, error: unknown): void {
  testInfo.annotations.push({
    type: 'cdp-lifecycle-recorder',
    description: `${stage}: ${error instanceof Error ? error.message : String(error)}`,
  });
}

export const test = baseTest.extend<CtHarnessTestFixtures, CtHarnessWorkerFixtures>({
  _optionContextReuseMode: [
    resolveCtContextReuseMode({ env: process.env }),
    { scope: 'worker', option: true, box: true },
  ],

  _ctIsolatedContextGuard: [
    async ({ page, _optionContextReuseMode }, use) => {
      if (_optionContextReuseMode === 'none') await assertFreshBrowserContext(page);
      await use();
    },
    { auto: true, box: true },
  ],

  _ctCdpLifecycleRecorder: [
    async ({ page }, use, testInfo) => {
      let recorder: Awaited<ReturnType<typeof startRecorder>> | undefined;
      try {
        recorder = await startRecorder(page);
      } catch (error) {
        annotateRecorderProblem(testInfo, 'not started', error);
      }
      await use();
      if (!recorder) return;
      try {
        await attachRecording(testInfo, recorder.events);
      } catch (error) {
        annotateRecorderProblem(testInfo, 'not attached', error);
      } finally {
        await recorder.session.detach().catch(() => undefined);
      }
    },
    { auto: true, box: true },
  ],
});

export { expect };
