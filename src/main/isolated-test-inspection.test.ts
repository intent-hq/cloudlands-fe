// protocol-version-ok-file: packaged inspection is bound to the selected daemon contract.
import { afterEach, expect, it, vi } from 'vitest';

const frontendSha = 'a'.repeat(40);
const backendSha = 'b'.repeat(40);

async function fixture() {
  vi.resetModules();
  const profile = {
    root: '/private/test',
    userData: '/private/test/desktop',
    home: '/private/test/home',
    data: '/private/test/daemon',
    socket: '/private/test/daemon/intentd.sock',
    backendSha,
  };
  const hello = {
    clientId: 'isolated-client',
    server: {
      protocolVersion: '14.0',
      buildCommit: backendSha.slice(0, 12),
      locality: 'local',
      capabilities: {
        collaborationIdentity: 1,
        hostMembership: 1,
        personalPairing: 1,
        repositoryContext: 1,
        repositorySelection: 1,
        repositoryResourceRead: 1,
        nativeReview: 1,
        nativeReviewCompanion: 1,
      } as Record<string, number>,
    },
  };
  const status = { buildCommit: hello.server.buildCommit };
  const config = { transport: 'uds', socketPath: profile.socket };
  const run = {
    available: true,
    startedAt: '2026-10-13T00:00:00Z',
    endedAt: null as string | null,
    spawnError: null as string | null,
  };
  const build = {
    GIT_COMMIT_HASH: frontendSha,
    ISOLATED_TEST_BACKEND_SHA: backendSha,
  };
  const request = vi.fn(async (method: string) => {
    if (method === 'client.hello') return hello;
    if (method === 'system.status') return status;
    throw new Error(`Unexpected request ${method}`);
  });
  const getStatus = vi.fn(() => 'connected');
  const isolated = vi.fn(() => true);
  vi.doMock('../features/backend/main/backend.ipc', () => ({
    getBackendClient: () => ({ request, getStatus, getConfig: () => config }),
  }));
  vi.doMock('../features/backend/main/intentd-sidecar', () => ({
    getSidecarRunLog: () => run,
  }));
  vi.doMock('./build-config.generated.js', () => ({ BUILD_CONFIG: build }));
  vi.doMock('./isolated-test-profile', () => ({
    getIsolatedTestProfile: () => profile,
    isIsolatedTestBuild: isolated,
  }));
  const app = {
    getName: () => 'Intent GitLab Test',
    getPath: (name: string) => (name === 'userData' ? profile.userData : profile.home),
  };
  const { inspectIsolatedTestPackage } = await import('./isolated-test-inspection');
  return {
    hello,
    status,
    config,
    run,
    build,
    profile,
    app,
    request,
    isolated,
    getStatus,
    inspect: (protocolVersion?: string) =>
      inspectIsolatedTestPackage(app, { frontendSha, backendSha, protocolVersion }),
  };
}

afterEach(() => {
  vi.doUnmock('../features/backend/main/backend.ipc');
  vi.doUnmock('../features/backend/main/intentd-sidecar');
  vi.doUnmock('./build-config.generated.js');
  vi.doUnmock('./isolated-test-profile');
  vi.resetModules();
});

it('inspects the selected daemon contract through the original connected client', async () => {
  const f = await fixture();
  const result = await f.inspect();
  expect(result.hello).toEqual(f.hello);
  expect(result.backendSha).toBe(backendSha);
  expect(result.frontendSha).toBe(frontendSha);
  expect(f.request.mock.calls).toEqual([['client.hello'], ['system.status']]);
});

it.each(['14.0', '14.1'])('accepts exactly selected protocol %s', async (protocolVersion) => {
  const f = await fixture();
  f.hello.server.protocolVersion = protocolVersion;
  expect((await f.inspect(protocolVersion)).hello.server.protocolVersion).toBe(protocolVersion);
  expect(f.request.mock.calls).toEqual([['client.hello'], ['system.status']]);
});

it.each([
  ['14.0', '14.1'],
  ['14.1', '14.0'],
])('rejects protocol %s when selected source requires %s', async (actual, expected) => {
  const f = await fixture();
  f.hello.server.protocolVersion = actual;
  await expect(f.inspect(expected)).rejects.toThrow();
  expect(f.request.mock.calls).toEqual([['client.hello']]);
});

it.each(['13.3', '14.2', '15.0', ''])('rejects unsupported expectation %s', async (version) => {
  const f = await fixture();
  f.hello.server.protocolVersion = version;
  await expect(f.inspect(version)).rejects.toThrow('Unsupported inspection protocol');
  expect(f.request).not.toHaveBeenCalled();
});

it.each(['13.3', '14.1', '14.2', '15.0', ''])(
  'rejects an unexpected protocol %s',
  async (version) => {
    const f = await fixture();
    f.hello.server.protocolVersion = version;
    await expect(f.inspect()).rejects.toThrow();
    expect(f.request.mock.calls).toEqual([['client.hello']]);
  },
);

it.each([
  [
    'frontend identity',
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.build.GIT_COMMIT_HASH = 'c'.repeat(40);
    },
  ],
  [
    'daemon identity',
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.hello.server.buildCommit = 'c'.repeat(40);
    },
  ],
  [
    'status identity',
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.status.buildCommit = 'c'.repeat(40);
    },
  ],
  [
    'required capability',
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.hello.server.capabilities.nativeReview = 0;
    },
  ],
  [
    'normal socket',
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.config.socketPath = '/normal/intentd.sock';
    },
  ],
  [
    'normal application paths',
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.app.getPath = () => '/normal';
    },
  ],
  [
    'ended sidecar',
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.run.endedAt = '2026-10-13T00:01:00Z';
    },
  ],
  [
    'ordinary build',
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.isolated.mockReturnValue(false);
    },
  ],
] as const)('still rejects %s', async (_name, invalidate) => {
  const f = await fixture();
  invalidate(f);
  await expect(f.inspect()).rejects.toThrow();
});
