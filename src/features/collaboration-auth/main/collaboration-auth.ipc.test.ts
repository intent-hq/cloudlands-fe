import { EventEmitter } from 'node:events';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { COLLABORATION_AUTH } from '../types';

const state = vi.hoisted(() => ({
  handlers: new Map<string, (event: any, input?: any) => any>(),
  localRequest: vi.fn(),
  remoteRequest: vi.fn(),
  current: true,
  parent: null as any,
  status: null as null | ((status: string) => void),
}));
vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => state.parent, fromWebContents: () => state.parent },
  ipcMain: { handle: (key: string, fn: any) => state.handlers.set(key, fn) },
  shell: { openExternal: vi.fn(async () => {}) },
}));
vi.mock('../../../main/state', () => ({ getMainWindow: () => state.parent }));
vi.mock('../../backend/main/backend.ipc', () => ({
  captureLocalIdentityConnection: () => ({
    supported: true,
    gitlabSupported: true,
    current: () => state.current,
    request: state.localRequest,
  }),
  getBackendClientForIpcEvent: () => ({ client: { request: state.remoteRequest } }),
  onBackendStatus: (handler: (status: string) => void) => {
    state.status = handler;
    return () => {
      state.status = null;
    };
  },
}));
import {
  prepareCollaborationIdentity,
  registerCollaborationAuthHandlers,
} from './collaboration-auth.ipc';

function invoke(channel: string, input?: unknown, contentsId = 41) {
  return state.handlers.get(channel)!({ sender: { id: contentsId } }, input);
}
const pin = { provider: 'github' as const, host: 'github.com', externalUserId: '19' };
beforeEach(() => {
  vi.useFakeTimers();
  state.current = true;
  state.remoteRequest.mockReset();
  const contents = Object.assign(new EventEmitter(), {
    id: 41,
    isDestroyed: () => false,
    send: vi.fn(),
  });
  state.parent = { webContents: contents, isDestroyed: () => false, backendId: 'remote-A' };
  state.localRequest.mockReset().mockImplementation(async (method: string) => {
    if (method === 'identity.authStatus')
      return {
        purpose: 'collaboration',
        provider: 'github',
        host: 'github.com',
        isConfigured: true,
        configuredButNeedsUpdate: false,
        requestedScopes: ['gist'],
        grantedScopes: ['gist'],
        deviceGrantSupported: true,
      };
    if (method === 'identity.getUser') return { user: { id: '19', login: 'local-B-person' } };
    if (method === 'identity.select') return { principal: { identity: pin } };
    throw new Error('unexpected method');
  });
  registerCollaborationAuthHandlers();
});
afterEach(() => vi.useRealTimers());

describe('collaboration main IPC local routing', () => {
  it('a remote-A window authenticates only local B, with no account or token payload to A', async () => {
    const done = prepareCollaborationIdentity({ scope: 'workspace', pinIdentity: pin });
    const view = state.parent.webContents.send.mock.calls[0][1];
    expect(state.localRequest).not.toHaveBeenCalled();
    await invoke(COLLABORATION_AUTH.POLICY, { multiplayer: true, gitlab: false });
    await invoke(COLLABORATION_AUTH.ACTION, {
      requestId: view.requestId,
      action: { type: 'confirm' },
    });
    const result = await done;
    expect(result).toMatchObject({
      kind: 'ready',
      prepared: { identity: pin, login: 'local-B-person' },
    });
    expect(state.remoteRequest).not.toHaveBeenCalled();
    expect(state.localRequest.mock.calls.map(([method]) => method)).toEqual([
      'identity.authStatus',
      'identity.getUser',
      'identity.authStatus',
      'identity.getUser',
      'identity.select',
    ]);
    expect(JSON.stringify(state.parent.webContents.send.mock.calls)).not.toMatch(
      /token|localRequest|secret/,
    );
    await invoke(COLLABORATION_AUTH.POLICY, { multiplayer: false, gitlab: false });
    if (result.kind === 'ready') expect(result.prepared.allowed()).toBe(false);
  });
  it('off policy blocks direct open IPC and auth, while leaving the invitation pin intact', async () => {
    const done = prepareCollaborationIdentity({ scope: 'host', pinIdentity: pin });
    await invoke(COLLABORATION_AUTH.POLICY, { multiplayer: false, gitlab: true });
    expect(await done).toEqual({
      kind: 'cancelled',
      request: { scope: 'host', pinIdentity: pin },
      selection: { target: { provider: 'github', host: 'github.com' } },
    });
    expect(state.localRequest).not.toHaveBeenCalled();
    await invoke(COLLABORATION_AUTH.OPEN);
    await invoke(COLLABORATION_AUTH.POLICY, { multiplayer: false, gitlab: true });
    expect(state.localRequest).not.toHaveBeenCalled();
  });
  it('another window and stale or malformed responses cannot confirm an account', async () => {
    const done = prepareCollaborationIdentity({ scope: 'workspace', pinIdentity: pin });
    const view = state.parent.webContents.send.mock.calls[0][1];
    await invoke(COLLABORATION_AUTH.POLICY, { multiplayer: true, gitlab: true });
    for (const [id, requestId, action] of [
      [99, view.requestId, { type: 'confirm' }],
      [41, 'stale', { type: 'confirm' }],
      [41, view.requestId, { type: 'confirm', token: 'private-token' }],
    ] as const)
      expect(await invoke(COLLABORATION_AUTH.ACTION, { requestId, action }, id)).toEqual({
        ok: false,
      });
    expect(state.localRequest.mock.calls.some(([method]) => method === 'identity.select')).toBe(
      false,
    );
    state.parent.webContents.emit('did-navigate');
    expect((await done).kind).toBe('cancelled');
  });
  it('invalidates a flow when the captured local connection ends', async () => {
    const done = prepareCollaborationIdentity({ scope: 'workspace', pinIdentity: pin });
    await invoke(COLLABORATION_AUTH.POLICY, { multiplayer: true, gitlab: true });
    state.current = false;
    state.status?.('disconnected');
    expect(await done).toMatchObject({ kind: 'error', code: 'local-connection-changed' });
    expect(state.remoteRequest).not.toHaveBeenCalled();
  });
  it('invitation B supersedes A on the same local daemon and ignores the late A result', async () => {
    const oldStatus = Promise.withResolvers<any>();
    state.localRequest.mockImplementationOnce(() => oldStatus.promise);
    const a = prepareCollaborationIdentity(
      { scope: 'host', pinIdentity: pin, hostLabel: 'A' },
      { attempt: { id: 'A', metadataRevision: 1, current: () => true } },
    );
    const actionA = invoke(COLLABORATION_AUTH.POLICY, { multiplayer: true, gitlab: false });
    const b = prepareCollaborationIdentity(
      { scope: 'workspace', pinIdentity: pin, hostLabel: 'B' },
      { attempt: { id: 'B', metadataRevision: 2, current: () => true } },
    );
    const viewB = state.parent.webContents.send.mock.calls.at(-1)![1];
    expect(await a).toMatchObject({ kind: 'cancelled', request: { hostLabel: 'A' } });
    oldStatus.resolve({
      purpose: 'collaboration',
      provider: 'github',
      host: 'github.com',
      isConfigured: true,
      requestedScopes: ['gist'],
      grantedScopes: ['gist'],
    });
    await actionA;
    await invoke(COLLABORATION_AUTH.POLICY, { multiplayer: true, gitlab: false });
    await invoke(COLLABORATION_AUTH.ACTION, {
      requestId: viewB.requestId,
      action: { type: 'confirm' },
    });
    expect(await b).toMatchObject({
      kind: 'ready',
      prepared: { attempt: { id: 'B', metadataRevision: 2 }, invitation: { hostLabel: 'B' } },
    });
    expect(
      state.localRequest.mock.calls.filter(([method]) => method === 'identity.select'),
    ).toHaveLength(1);
    expect(state.remoteRequest).not.toHaveBeenCalled();
  });
  it('a renderer send failure settles cancellation without exposing the exception', async () => {
    state.parent.webContents.send.mockImplementation(() => {
      throw new Error('sensitive fixture');
    });
    await expect(prepareCollaborationIdentity({ scope: 'settings' })).resolves.toMatchObject({
      kind: 'cancelled',
    });
    expect(state.localRequest).not.toHaveBeenCalled();
  });
  it('window navigation invalidates an already prepared continuation', async () => {
    const done = prepareCollaborationIdentity({ scope: 'host', pinIdentity: pin });
    const view = state.parent.webContents.send.mock.calls[0][1];
    await invoke(COLLABORATION_AUTH.POLICY, { multiplayer: true, gitlab: false });
    await invoke(COLLABORATION_AUTH.ACTION, {
      requestId: view.requestId,
      action: { type: 'confirm' },
    });
    const result = await done;
    state.parent.webContents.emit('did-navigate');
    if (result.kind !== 'ready') throw new Error('Expected prepared identity');
    expect(result.prepared.attempt.current()).toBe(false);
    expect(result.prepared.allowed()).toBe(false);
  });
});
