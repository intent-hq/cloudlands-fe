// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';

const fixtures = vi.hoisted(() => ({ definitions: {} as Record<string, unknown> }));
vi.mock('@playwright/test', () => ({
  test: {
    extend(definitions: Record<string, unknown>) {
      fixtures.definitions = definitions;
      return definitions;
    },
  },
}));

// An inert registry points at this test file for hashing. No browser is installed,
// launched, or queried by these controls; the fixture itself remains the consumer.
vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  return {
    ...actual,
    createRequire: (path: string | URL) => {
      const require = actual.createRequire(path);
      return new Proxy(require, {
        apply(target, receiver, args: [string]) {
          if (args[0] === 'playwright-core/lib/coreBundle') {
            return {
              registry: {
                registry: {
                  findExecutable: () => ({
                    browserVersion: '123.0.0.0',
                    executablePath: () => fileURLToPath(import.meta.url),
                  }),
                },
              },
            };
          }
          return Reflect.apply(target, receiver, args);
        },
      });
    },
  };
});

import '../test/root-browser-fixtures';

type Identity = {
  observation: { runtime: { product: string }; commandLine: string };
  plan: { executablePath: string; browserVersion: string };
};
type Fixture = (...args: unknown[]) => Promise<void>;
const worker = () => (fixtures.definitions._rootRuntimeIdentity as [Fixture])[0];
const attempt = () => (fixtures.definitions._rootRuntimeEvidence as [Fixture])[0];
const runtime = {
  product: 'HeadlessChrome/123.0.0.0',
  revision: 'supplied',
  jsVersion: 'supplied',
  userAgent: 'supplied',
  protocolVersion: '1.3',
};
const executable = fileURLToPath(import.meta.url);

function browserFixture(failMethod?: string, detachError?: Error) {
  const calls: string[] = [];
  const failure = new Error('supplied protocol failure');
  const browser = {
    async newBrowserCDPSession() {
      calls.push('session');
      return {
        async send(method: string) {
          calls.push(method);
          if (method === failMethod) throw failure;
          if (method === 'Browser.getVersion') return runtime;
          if (method === 'SystemInfo.getInfo') {
            return { commandLine: `${executable} --headless --remote-debugging-pipe` };
          }
          throw new Error('Command line not returned because --enable-automation not set.');
        },
        async detach() {
          calls.push('detach');
          if (detachError) throw detachError;
        },
      };
    },
  };
  return { browser, calls, failure };
}

function options(browser: ReturnType<typeof browserFixture>['browser']) {
  return { browser, browserName: 'chromium', headless: true, launchOptions: {} };
}

async function capture() {
  let identity: Identity | undefined;
  const fixture = browserFixture();
  await worker()(options(fixture.browser), async (value: Identity) => {
    identity = value;
  });
  if (!identity) throw new Error('Worker fixture did not publish identity');
  return { identity, fixture };
}

describe('root browser runtime fixture', () => {
  beforeEach(() => vi.clearAllMocks());

  it('captures an ordinary browser without requiring enable-automation or changing its launch', async () => {
    const { identity, fixture } = await capture();
    expect(fixture.calls).toEqual([
      'session',
      'Browser.getVersion',
      'SystemInfo.getInfo',
      'detach',
    ]);
    expect(identity.observation).toEqual({
      runtime,
      commandLine: `${executable} --headless --remote-debugging-pipe`,
    });
  });

  it.each(['Browser.getVersion', 'SystemInfo.getInfo'])(
    'retains %s failure and detaches',
    async (method) => {
      const fixture = browserFixture(method);
      const use = vi.fn();
      await expect(worker()(options(fixture.browser), use)).rejects.toBe(fixture.failure);
      expect(fixture.calls.at(-1)).toBe('detach');
      expect(use).not.toHaveBeenCalled();
    },
  );

  it('retains both observation and detach errors', async () => {
    const detachError = new Error('supplied detach error');
    const fixture = browserFixture('SystemInfo.getInfo', detachError);
    const error = await worker()(options(fixture.browser), vi.fn()).catch(
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([fixture.failure, detachError]);
    expect((error as AggregateError).cause).toBe(fixture.failure);
  });

  it('fails capture when detach fails after successful queries', async () => {
    const error = new Error('supplied detach error');
    const fixture = browserFixture(undefined, error);
    await expect(worker()(options(fixture.browser), vi.fn())).rejects.toBe(error);
  });

  it.each([
    { browserName: 'firefox' },
    { channel: 'chrome' },
    { connectOptions: { wsEndpoint: 'supplied' } },
    { launchOptions: { executablePath: '/supplied/override' } },
  ])('refuses an overridden runtime selection before opening CDP: %j', async (override) => {
    const fixture = browserFixture();
    await expect(worker()({ ...options(fixture.browser), ...override }, vi.fn())).rejects.toThrow(
      'unchanged local Chromium selection',
    );
    expect(fixture.calls).toEqual([]);
  });

  it('attaches the measured command line and attempt identity before admitting the body', async () => {
    const { identity } = await capture();
    const calls: string[] = [];
    const attach = vi.fn(async () => {
      calls.push('attach');
    });
    await attempt()(
      { _rootRuntimeIdentity: identity },
      async () => {
        calls.push('body');
      },
      {
        attach,
        retry: 2,
        workerIndex: 7,
        titlePath: ['supplied case'],
      },
    );
    expect(calls).toEqual(['attach', 'body']);
    const [name, data] = attach.mock.calls[0] as unknown as [string, { body: string }];
    expect(name).toBe('root-runtime.json');
    expect(JSON.parse(data.body)).toMatchObject({
      observation: identity.observation,
      retry: 2,
      workerIndex: 7,
      test: ['supplied case'],
    });
  });

  it.each([
    '',
    '/foreign/browser --headless',
    `${executable}-other --headless`,
    `prefix ${executable}`,
  ])('retains and rejects a missing or different executable command: %s', async (commandLine) => {
    const { identity } = await capture();
    identity.observation.commandLine = commandLine;
    const attach = vi.fn();
    const body = vi.fn();
    await expect(
      attempt()({ _rootRuntimeIdentity: identity }, body, {
        attach,
        retry: 0,
        workerIndex: 0,
        titlePath: [],
      }),
    ).rejects.toThrow('selected executable');
    expect(attach).toHaveBeenCalledOnce();
    expect(body).not.toHaveBeenCalled();
  });

  it.each([executable, `"${executable}" --headless`, '/supplied/Chrome Browser --headless'])(
    'accepts the selected executable with the serialized command boundary: %s',
    async (commandLine) => {
      const { identity } = await capture();
      if (commandLine.startsWith('/supplied/'))
        identity.plan.executablePath = '/supplied/Chrome Browser';
      identity.observation.commandLine = commandLine;
      const body = vi.fn();
      await attempt()({ _rootRuntimeIdentity: identity }, body, {
        attach: vi.fn(),
        retry: 0,
        workerIndex: 0,
        titlePath: [],
      });
      expect(body).toHaveBeenCalledOnce();
    },
  );

  it('retains runtime-version mismatch and denies the body', async () => {
    const { identity } = await capture();
    identity.observation.runtime = { product: 'HeadlessChrome/122.0.0.0' };
    const body = vi.fn();
    await expect(
      attempt()({ _rootRuntimeIdentity: identity }, body, {
        attach: vi.fn(),
        retry: 0,
        workerIndex: 0,
        titlePath: [],
      }),
    ).rejects.toThrow('Unexpected root Chromium runtime');
    expect(body).not.toHaveBeenCalled();
  });

  it('does not admit a body when attachment fails or swallow a body failure', async () => {
    const { identity } = await capture();
    const error = new Error('supplied failure');
    const body = vi.fn();
    await expect(
      attempt()({ _rootRuntimeIdentity: identity }, body, {
        attach: vi.fn().mockRejectedValue(error),
        retry: 0,
        workerIndex: 0,
        titlePath: [],
      }),
    ).rejects.toBe(error);
    expect(body).not.toHaveBeenCalled();
    await expect(
      attempt()({ _rootRuntimeIdentity: identity }, vi.fn().mockRejectedValue(error), {
        attach: vi.fn(),
        retry: 0,
        workerIndex: 0,
        titlePath: [],
      }),
    ).rejects.toBe(error);
  });
});
