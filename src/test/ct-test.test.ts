// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ctHarnessFixtures } from './ct-test';

// A minimal model of Playwright's fixture protocol, independent of the module
// under test: a fixture's dependencies are the names it destructures from its
// first argument; auto fixtures are set up in registration order, each after
// its dependencies; a setup error marks the test failed; every fixture that
// completed setup is then torn down (its `use()` resolves) in reverse order.

type FixtureFn = (
  args: Record<string, unknown>,
  use: () => Promise<void>,
  testInfo: FakeTestInfo,
) => Promise<void>;
type FixtureEntry = [FixtureFn | string, { auto?: boolean }];
type FixtureTable = Record<string, FixtureEntry>;

interface FakeTestInfo {
  status: string;
  expectedStatus: string;
  titlePath: string[];
  retry: number;
  workerIndex: number;
  annotations: Array<{ type: string; description?: string }>;
  attach: ReturnType<typeof vi.fn>;
}

function declaredDependencies(fn: FixtureFn): string[] {
  const match = fn.toString().match(/\(\s*\{([^}]*)\}/);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((prop) => prop.split(':')[0].trim())
    .filter(Boolean);
}

function fakeTestInfo(): FakeTestInfo {
  return {
    status: 'passed',
    expectedStatus: 'passed',
    titlePath: ['ct-test.test.ts', 'case'],
    retry: 0,
    workerIndex: 0,
    annotations: [],
    attach: vi.fn(async () => undefined),
  };
}

function fakePage(browserContextId: string) {
  const sessions: Array<{ detach: ReturnType<typeof vi.fn> }> = [];
  const page = {
    context: () => ({
      newCDPSession: async () => {
        const session = {
          on: vi.fn(),
          send: vi.fn(async (method: string) =>
            method === 'Target.getTargetInfo' ? { targetInfo: { browserContextId } } : {},
          ),
          detach: vi.fn(async () => undefined),
        };
        sessions.push(session);
        return session;
      },
    }),
  };
  return { page, sessions };
}

async function runWithFixtures(
  fixtures: FixtureTable,
  page: unknown,
  testInfo: FakeTestInfo,
): Promise<{ error: unknown; setUpOrder: string[] }> {
  const resolved = new Map<string, unknown>([['page', page]]);
  const setUpOrder: string[] = [];
  const teardowns: Array<{ release: () => void; done: Promise<void> }> = [];

  async function setUp(name: string): Promise<void> {
    if (resolved.has(name)) return;
    const [impl] = fixtures[name];
    if (typeof impl !== 'function') {
      resolved.set(name, impl);
      return;
    }
    for (const dependency of declaredDependencies(impl)) await setUp(dependency);
    const args = Object.fromEntries(declaredDependencies(impl).map((d) => [d, resolved.get(d)]));
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let setupDone!: () => void;
    const setupComplete = new Promise<void>((resolve) => (setupDone = resolve));
    const done = impl(
      args,
      async () => {
        setupDone();
        await released;
      },
      testInfo,
    );
    await Promise.race([setupComplete, done]);
    setUpOrder.push(name);
    resolved.set(name, undefined);
    teardowns.push({ release, done });
  }

  let error: unknown;
  try {
    for (const [name, [, options]] of Object.entries(fixtures)) {
      if (options.auto) await setUp(name);
    }
  } catch (caught) {
    error = caught;
    testInfo.status = 'failed';
  }
  for (const { release, done } of teardowns.reverse()) {
    release();
    await done;
  }
  return { error, setUpOrder };
}

function harness(mode: 'none' | 'when-possible'): FixtureTable {
  const table = ctHarnessFixtures as unknown as FixtureTable;
  return { ...table, _optionContextReuseMode: [mode, table._optionContextReuseMode[1]] };
}

describe('shared CT test module fixtures', () => {
  it('attaches cdp-lifecycle.json when the isolation guard fails on a reused context', async () => {
    const first = await runWithFixtures(
      harness('none'),
      fakePage('ctx-reused').page,
      fakeTestInfo(),
    );
    expect(first.error).toBeUndefined();

    const { page, sessions } = fakePage('ctx-reused');
    const testInfo = fakeTestInfo();
    const { error, setUpOrder } = await runWithFixtures(harness('none'), page, testInfo);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/already used by an earlier test in this worker/);
    expect(setUpOrder).toEqual(['_ctCdpLifecycleRecorder']);
    expect(testInfo.attach).toHaveBeenCalledTimes(1);
    const [name, { contentType, body }] = testInfo.attach.mock.calls[0] as [
      string,
      { contentType: string; body: string },
    ];
    expect(name).toBe('cdp-lifecycle.json');
    expect(contentType).toBe('application/json');
    expect(JSON.parse(body)).toMatchObject({ status: 'failed', workerIndex: 0, events: [] });
    expect(testInfo.annotations).toEqual([]);
    for (const session of sessions) expect(session.detach).toHaveBeenCalled();
  });

  it('attaches nothing and detaches both CDP sessions when the test passes', async () => {
    const { page, sessions } = fakePage('ctx-fresh');
    const testInfo = fakeTestInfo();
    const { error } = await runWithFixtures(harness('none'), page, testInfo);

    expect(error).toBeUndefined();
    expect(testInfo.attach).not.toHaveBeenCalled();
    expect(testInfo.annotations).toEqual([]);
    expect(sessions).toHaveLength(2);
    for (const session of sessions) expect(session.detach).toHaveBeenCalledTimes(1);
  });

  it('skips the isolation guard when context reuse is the resolved mode', async () => {
    const first = await runWithFixtures(
      harness('when-possible'),
      fakePage('ctx-escape-hatch').page,
      fakeTestInfo(),
    );
    const second = await runWithFixtures(
      harness('when-possible'),
      fakePage('ctx-escape-hatch').page,
      fakeTestInfo(),
    );

    expect(first.error).toBeUndefined();
    expect(second.error).toBeUndefined();
  });

  it('reports a recorder that cannot start as an annotation, never as a failure', async () => {
    const page = {
      context: () => ({
        newCDPSession: async () => {
          throw new Error('CDP unavailable');
        },
      }),
    };
    const testInfo = fakeTestInfo();
    const { error } = await runWithFixtures(harness('when-possible'), page, testInfo);

    expect(error).toBeUndefined();
    expect(testInfo.attach).not.toHaveBeenCalled();
    expect(testInfo.annotations).toEqual([
      { type: 'cdp-lifecycle-recorder', description: 'not started: CDP unavailable' },
    ]);
  });
});
