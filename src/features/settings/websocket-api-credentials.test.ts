import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginWebsocketCredentialRequest,
  clearAllWebsocketCredentials,
  readWebsocketToken,
  receiveWebsocketCredentials,
  registerWebsocketCredentials,
} from './websocket-api-credentials';

const identity = { formId: 'api', sessionId: 'first', requestId: 'read', resource: 'load' };
afterEach(clearAllWebsocketCredentials);

describe('mount-scoped API credential delivery', () => {
  it('delivers only the current full request identity and releases credentials on close', () => {
    const receive = vi.fn();
    const close = registerWebsocketCredentials('api', 'first', receive);
    beginWebsocketCredentialRequest(identity);
    receiveWebsocketCredentials({ ...identity, requestId: 'stale' }, { token: 'stale-fixture' });
    expect(receive).not.toHaveBeenCalled();
    receiveWebsocketCredentials(identity, { token: 'current-fixture' });
    expect(readWebsocketToken(identity)).toBe('current-fixture');
    close();
    expect(readWebsocketToken(identity)).toBe('');
    expect(receive).toHaveBeenLastCalledWith({ token: '', qrDataUrl: '' });
    receiveWebsocketCredentials(identity, { token: 'late-fixture' });
    expect(readWebsocketToken(identity)).toBe('');
  });

  it('does not let an old disposer or response touch a replacement form session', () => {
    const old = vi.fn();
    const closeOld = registerWebsocketCredentials('api', 'first', old);
    beginWebsocketCredentialRequest(identity);
    const current = vi.fn();
    registerWebsocketCredentials('api', 'second', current);
    const next = { ...identity, sessionId: 'second' };
    beginWebsocketCredentialRequest(next);
    closeOld();
    receiveWebsocketCredentials(identity, { token: 'old-fixture' });
    expect(current).not.toHaveBeenCalled();
    receiveWebsocketCredentials(next, { token: 'new-fixture' });
    expect(readWebsocketToken(next)).toBe('new-fixture');
    expect(readWebsocketToken(identity)).toBe('');
  });

  it('clears every mounted credential receiver on saga teardown', () => {
    const receive = vi.fn();
    registerWebsocketCredentials('api', 'first', receive);
    beginWebsocketCredentialRequest(identity);
    receiveWebsocketCredentials(identity, { token: 'fixture', qrDataUrl: 'fixture-qr' });
    clearAllWebsocketCredentials();
    expect(receive).toHaveBeenLastCalledWith({ token: '', qrDataUrl: '' });
    expect(readWebsocketToken(identity)).toBe('');
  });
});
