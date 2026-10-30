import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// FAKE transport only (shared MockBackendTransport fixture): asserts the
// §5.56 `secret.*` JSON-RPC method + params and the result folding.
vi.mock('./backend-transport', async () => {
  const mod = await import('../../../test/mocks/backend-transport.mock');
  return mod.mockBackendTransportModule;
});

import {
  BackendError,
  buildErrorPayload,
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '../../../test/mocks/backend-transport.mock';
import { LiveAgentsClient } from './live-agents-client';

describe('LiveAgentsClient secret requests (fake transport)', () => {
  let backend: MockBackendHandle;
  beforeEach(() => {
    backend = installMockBackend();
  });
  afterEach(() => {
    resetMockBackend();
  });

  it('sends secret.provide with the value once and folds success', async () => {
    backend.onRequest('secret.provide', () => ({ ok: true, requestId: 'sec-1', name: 'KEY' }));
    const result = await new LiveAgentsClient().secretProvide({
      workspaceId: 'ws-1',
      requestId: 'sec-1',
      value: 'v4lue',
    });
    expect(result).toEqual({ ok: true });
    expect(backend.requests).toEqual([
      {
        method: 'secret.provide',
        params: { workspaceId: 'ws-1', requestId: 'sec-1', value: 'v4lue' },
      },
    ]);
  });

  it('reports a lost or answered request as expired', async () => {
    backend.onRequest('secret.dismiss', () => {
      throw new BackendError(
        buildErrorPayload('INVALID_PARAMS', 'secret request sec-1 is not pending', {
          rpcCode: -32602,
          data: { code: 'secret-request-unknown' },
        }),
      );
    });
    const result = await new LiveAgentsClient().secretDismiss({
      workspaceId: 'ws-1',
      requestId: 'sec-1',
    });
    expect(result).toMatchObject({ ok: false, expired: true });
    expect(backend.requests).toEqual([
      { method: 'secret.dismiss', params: { workspaceId: 'ws-1', requestId: 'sec-1' } },
    ]);
  });

  it('does not treat other failures as expired', async () => {
    backend.onRequest('secret.provide', () => {
      throw new BackendError(buildErrorPayload('FORBIDDEN', 'Forbidden', { rpcCode: -32003 }));
    });
    const result = await new LiveAgentsClient().secretProvide({
      workspaceId: 'ws-1',
      requestId: 'sec-1',
      value: 'v',
    });
    expect(result).toMatchObject({ ok: false, expired: false });
  });

  it('reads secret.list names only', async () => {
    backend.onRequest('secret.list', () => ({
      secrets: [{ name: 'KEY' }],
      pendingRequests: [{ requestId: 'sec-2', name: 'OTHER' }],
      answeredRequests: [{ requestId: 'sec-1', name: 'KEY', outcome: 'provided' }],
    }));
    const listing = await new LiveAgentsClient().secretList({ workspaceId: 'ws-1', agentId: 'a1' });
    expect(backend.requests).toEqual([
      { method: 'secret.list', params: { workspaceId: 'ws-1', agentId: 'a1' } },
    ]);
    expect(listing?.pendingRequests).toEqual([{ requestId: 'sec-2', name: 'OTHER' }]);
    expect(listing?.answeredRequests[0].outcome).toBe('provided');
  });
});
