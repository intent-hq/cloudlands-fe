import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AntigravitySetupSession } from './setup-session';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  dispose: vi.fn(),
  handlers: new Map<string, (params: unknown) => Promise<unknown>>(),
  events: new Map<string, (value: string) => void>(),
}));
vi.mock('../../backend/main/client-identity', () => ({
  getOrCreateClientId: async () => 'app-client',
}));
vi.mock('../../backend/main/json-rpc-client', () => ({
  JsonRpcClient: class {
    request = mocks.request;
    dispose = mocks.dispose;
    on(event: string, handler: (value: string) => void) {
      mocks.events.set(event, handler);
    }
    registerMethod(method: string, handler: (params: unknown) => Promise<unknown>) {
      mocks.handlers.set(method, handler);
    }
  },
}));

const status = {
  operationId: 'operation-1',
  supported: true,
  cliDetected: true,
  runtimeInstalled: true,
  phase: 'signInRequired',
};
const url = 'https://accounts.google.com/o/oauth2/v2/auth?state=private-test-value';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.events.clear();
  mocks.request.mockImplementation(async (method: string) =>
    method === 'client.hello' ? { server: { capabilities: { antigravitySetup: 1 } } } : status,
  );
});

function session(current = () => true) {
  const open = vi.fn(async (_url: string) => undefined);
  return {
    open,
    client: new AntigravitySetupSession(
      { transport: 'uds', socketPath: '/fixture/socket' },
      current,
      open,
    ),
  };
}

describe('Antigravity private setup session', () => {
  it('removes unknown fields before the response enters IPC or Redux', async () => {
    const { client } = session();
    mocks.request.mockResolvedValueOnce({ ...status, url });
    const result = await client.request('status');
    expect(result).toEqual({ ok: true, status });
    expect(JSON.stringify(result)).not.toContain('private-test-value');
  });

  it('distinguishes an older daemon from a failed connection', async () => {
    mocks.request.mockResolvedValueOnce({ server: { capabilities: {} } });
    expect(await session().client.request('status')).toEqual({ ok: false, code: 'updateRequired' });
    mocks.request.mockRejectedValueOnce(new Error(url));
    const result = await session().client.request('status');
    expect(result).toEqual({ ok: false, code: 'connectionLost' });
    expect(JSON.stringify(result)).not.toContain(url);
  });

  it('opens one validated Google URL only for the explicit current login', async () => {
    const { client, open } = session();
    const reverse = mocks.handlers.get('providers.setup.openLogin')!;
    expect(await reverse({ operationId: status.operationId, url })).toEqual({ opened: false });
    await client.request('start');
    mocks.request.mockImplementationOnce(async () => {
      expect(await reverse({ operationId: 'another-operation', url })).toEqual({ opened: false });
      expect(await reverse({ operationId: status.operationId, url })).toEqual({ opened: true });
      expect(await reverse({ operationId: status.operationId, url })).toEqual({ opened: false });
      return { ...status, phase: 'signingIn' };
    });
    await client.request('login', status.operationId);
    expect(open).toHaveBeenCalledExactlyOnceWith(url);
  });

  it.each([
    'http://accounts.google.com/o/oauth2/auth',
    'https://accounts.google.com.evil.test/o/oauth2/auth',
    'https://user@accounts.google.com/o/oauth2/auth',
    'https://accounts.google.com:8443/o/oauth2/auth',
    'https://accounts.google.com/not-oauth',
    'https://accounts.google.com/o/oauth2/auth#fragment',
  ])('rejects an unsafe login URL without opening or echoing it: %s', async (invalid) => {
    const { client, open } = session();
    await client.request('start');
    mocks.request.mockImplementationOnce(async () => {
      expect(
        await mocks.handlers.get('providers.setup.openLogin')!({
          operationId: status.operationId,
          url: invalid,
        }),
      ).toEqual({ opened: false });
      return { ...status, phase: 'signingIn' };
    });
    await client.request('login', status.operationId);
    expect(open).not.toHaveBeenCalled();
  });

  it('cancels browser consent immediately and rejects stale or foreign operations', async () => {
    const { client, open } = session();
    await client.request('start');
    expect(await client.request('login', 'foreign')).toEqual({
      ok: false,
      code: 'invalidOperation',
    });
    let release!: (value: unknown) => void;
    mocks.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const login = client.request('login', status.operationId);
    await Promise.resolve();
    await client.request('cancel', status.operationId);
    expect(
      await mocks.handlers.get('providers.setup.openLogin')!({
        operationId: status.operationId,
        url,
      }),
    ).toEqual({ opened: false });
    expect(open).not.toHaveBeenCalled();
    release({ ...status, phase: 'cancelled' });
    await login;
  });

  it('does not resume work after a disconnect or backend switch', async () => {
    let current = true;
    const { client, open } = session(() => current);
    await client.request('status');
    current = false;
    expect(await client.request('start')).toEqual({ ok: false, code: 'backendChanged' });
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    const next = session().client;
    mocks.events.get('status')!('connected');
    mocks.events.get('status')!('disconnected');
    expect(await next.request('status')).toEqual({ ok: false, code: 'connectionLost' });
  });
});
