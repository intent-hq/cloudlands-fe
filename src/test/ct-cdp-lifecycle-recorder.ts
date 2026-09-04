import type { CDPSession, Page, TestInfo } from '@playwright/test';

/**
 * CDP lifecycle recorder for Playwright component tests (intent-hq/intent#4373).
 *
 * `mount()` intermittently fails on the merge queue with Playwright's generic
 * "Execution context was destroyed, most likely because of a navigation" —
 * a rewrite of any CDP error on the mount evaluate, so the failure never says
 * what actually happened to the page. This opens a second CDP session on the
 * test page and records execution-context and navigation lifecycle events with
 * timestamps; when the test fails the log is attached to the report as
 * `cdp-lifecycle.json`. It never throws: a recorder problem must not turn a
 * passing test red.
 */

interface LifecycleEvent {
  at: string;
  sinceStartMs: number;
  method: string;
  params: unknown;
}

interface Recorder {
  session: CDPSession;
  events: LifecycleEvent[];
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

const recorders = new WeakMap<TestInfo, Recorder>();

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

async function startRecorder(page: Page, testInfo: TestInfo): Promise<void> {
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
  recorders.set(testInfo, { session, events });
}

async function finishRecorder(testInfo: TestInfo): Promise<void> {
  const recorder = recorders.get(testInfo);
  if (!recorder) return;
  recorders.delete(testInfo);
  try {
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach('cdp-lifecycle.json', {
        contentType: 'application/json',
        body: JSON.stringify(
          {
            test: testInfo.titlePath,
            status: testInfo.status,
            retry: testInfo.retry,
            workerIndex: testInfo.workerIndex,
            events: recorder.events,
          },
          null,
          2,
        ),
      });
    }
  } finally {
    await recorder.session.detach().catch(() => undefined);
  }
}

interface HookableTest {
  beforeEach(hook: (fixtures: { page: Page }, testInfo: TestInfo) => Promise<void>): void;
  afterEach(hook: (fixtures: { page: Page }, testInfo: TestInfo) => Promise<void>): void;
}

/**
 * Registers the recorder as `beforeEach`/`afterEach` hooks on the given `test`.
 * Call it once at the top of a CT spec, after `test.setTimeout`/`test.use`.
 * Recording starts after the page fixture is ready (the harness has already
 * navigated to the CT host page) and therefore covers the `mount()` call and
 * everything the test does afterwards.
 */
export function recordCdpLifecycle(test: HookableTest): void {
  test.beforeEach(async ({ page }, testInfo) => {
    try {
      await startRecorder(page, testInfo);
    } catch (error) {
      testInfo.annotations.push({
        type: 'cdp-lifecycle-recorder',
        description: `not started: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });
  test.afterEach(async ({ page: _page }, testInfo) => {
    try {
      await finishRecorder(testInfo);
    } catch (error) {
      testInfo.annotations.push({
        type: 'cdp-lifecycle-recorder',
        description: `not attached: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });
}
