import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  enabled: false,
  request: vi.fn(),
  transport: {} as { request: ReturnType<typeof vi.fn> },
}));
vi.mock('./backend-transport-factory', () => ({
  resolveBackendTransport: () => fixture.transport,
}));
vi.mock('$store/renderer/store', () => ({ store: { state: {} } }));
vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectLabsRemoteAgentsEnabled: { select: () => fixture.enabled },
}));
import { backendRequest } from './backend-transport';

beforeEach(() => {
  fixture.enabled = false;
  fixture.request.mockReset();
  fixture.transport = { request: fixture.request };
  fixture.request.mockImplementation(async (method: string) => {
    if (method === 'client.hello')
      return { server: { capabilities: { agentNodes: 1, localNodeIsolation: 1 } } };
    return { ok: true };
  });
});
describe('renderer final wire boundary', () => {
  it('sends the canonical local request without altering workspace checkout selection', async () => {
    const params = {
      checkoutMode: 'cow',
      initialAgent: { placement: { target: 'local', checkout: 'isolated' } },
    };
    expect(await backendRequest('workspace.create', params)).toEqual({ ok: true });
    expect(fixture.request.mock.calls).toEqual([
      ['client.hello', {}],
      ['workspace.create', params, undefined],
    ]);
  });
  it('blocks remote command or deep-link payloads with Labs off', async () => {
    await expect(
      backendRequest('agent.create', {
        workspaceId: 'ws',
        placement: { target: 'remote', checkout: 'isolated' },
      }),
    ).rejects.toThrow();
    expect(fixture.request).not.toHaveBeenCalled();
  });
  it('checks fresh Labs state after deferred capability discovery', async () => {
    fixture.enabled = true;
    let resolve: (value: unknown) => void = () => {};
    const pending = new Promise((done) => {
      resolve = done;
    });
    fixture.request.mockImplementation(() => pending);
    const creation = backendRequest('agent.create', {
      workspaceId: 'ws',
      placement: { target: 'remote', checkout: 'isolated' },
    });
    await vi.waitFor(() => expect(fixture.request).toHaveBeenCalledWith('client.hello', {}));
    fixture.enabled = false;
    resolve({ server: { capabilities: { agentNodes: 1 } } });
    await expect(creation).rejects.toThrow();
    expect(fixture.request).toHaveBeenCalledTimes(1);
  });
  it('preserves management of existing remote agents with Labs off', async () => {
    await backendRequest('agent.stop', { agentId: 'remote' });
    await backendRequest('hub.discard', {
      workspaceId: 'ws',
      agentId: 'remote',
      requestId: '00000000-0000-4000-8000-000000000004',
    });
    expect(fixture.request.mock.calls.map(([method]) => method)).toEqual([
      'agent.stop',
      'hub.discard',
    ]);
  });
});
