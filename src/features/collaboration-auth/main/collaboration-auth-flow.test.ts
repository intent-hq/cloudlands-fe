import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CollaborationAuthFlow,
  CollaborationIdentityClient,
  type LocalIdentityLease,
  type PreparedCollaborationIdentity,
} from './collaboration-auth-flow';
import type {
  CollaborationAuthStatus,
  CollaborationOutcome,
  CollaborationRequest,
  CollaborationView,
} from '../types';

const github = { provider: 'github' as const, host: 'github.com', externalUserId: '17' };
const gitlab = { provider: 'gitlab' as const, host: 'gitlab.example:8443', externalUserId: '17' };
const scopes = (provider: string) => (provider === 'github' ? ['gist'] : ['api']);
function harness(request: CollaborationRequest = { scope: 'workspace', pinIdentity: github }) {
  let current = true;
  let attemptCurrent = true;
  const attempt = { id: 'invitation-A', metadataRevision: 1, current: () => attemptCurrent };
  let latest = true;
  let configured = false;
  let id = '17';
  let granted: string[] | null | undefined;
  let defaultIdentity: unknown = github;
  const views: CollaborationView[] = [];
  const finish = vi.fn<(result: CollaborationOutcome<PreparedCollaborationIdentity>) => void>();
  const openBrowser = vi.fn(async () => {});
  const ledger = vi.fn(async (method: string, params: any): Promise<any> => {
    const target = { provider: params.provider, host: params.host ?? 'github.com' };
    switch (method) {
      case 'principal.me':
        return { identity: defaultIdentity };
      case 'identity.authStatus':
        return {
          ...target,
          purpose: 'collaboration',
          isConfigured: configured,
          configuredButNeedsUpdate: false,
          requestedScopes: scopes(target.provider),
          grantedScopes: granted === undefined ? scopes(target.provider) : granted,
          deviceGrantSupported: true,
        } satisfies Partial<CollaborationAuthStatus>;
      case 'identity.getUser':
        return { user: configured ? { id, login: 'person' } : null };
      case 'identity.connect':
        return {
          purpose: 'collaboration',
          flowId: 'flow-1',
          userCode: 'VISIBLE-CODE',
          verificationUri: `https://${target.host}/login/device`,
          expiresIn: 600,
          interval: 2,
        };
      case 'identity.cancelAuth':
        return { ok: true, cancelled: true };
      case 'identity.select':
        return { principal: { identity: { ...target, externalUserId: id } } };
      case 'sourceControl.identityProof.create':
        return { ...target, externalUserId: id, proofId: 'proof-1', login: 'person' };
      case 'sourceControl.identityProof.delete':
        return { ok: true };
      default:
        throw new Error('Unexpected RPC');
    }
  });
  const local: LocalIdentityLease = {
    supported: true,
    gitlabSupported: true,
    current: () => current,
    request: ledger,
  };
  const flow = new CollaborationAuthFlow('request-1', request, {
    local,
    attempt,
    show: (view) => views.push(view),
    finish,
    openBrowser,
    isLatest: () => latest,
  });
  return {
    flow,
    local,
    attempt,
    setAttemptCurrent: (value: boolean) => (attemptCurrent = value),
    ledger,
    views,
    finish,
    openBrowser,
    setCurrent: (value: boolean) => (current = value),
    setLatest: (value: boolean) => (latest = value),
    setConfigured: (value: boolean) => (configured = value),
    setId: (value: string) => (id = value),
    setGranted: (value: string[] | null) => (granted = value),
    setDefault: (value: unknown) => (defaultIdentity = value),
  };
}
const enabled = { type: 'policy' as const, policy: { multiplayer: true, gitlab: true } };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('local collaboration sign-in', () => {
  it('starts without repository accounts and resumes only after visible account consent', async () => {
    const h = harness();
    await h.flow.action(enabled);
    expect(h.flow.snapshot()).toMatchObject({
      phase: 'account',
      user: null,
      requestedScopes: ['gist'],
    });
    expect(h.ledger.mock.calls.map(([method]) => method)).toEqual(['identity.authStatus']);
    await h.flow.action({ type: 'connect' });
    expect(h.ledger).toHaveBeenCalledWith('identity.connect', {
      provider: 'github',
      method: 'device',
    });
    expect(h.openBrowser).not.toHaveBeenCalled();
    await h.flow.action({ type: 'open-browser' });
    expect(h.openBrowser).toHaveBeenCalledWith('https://github.com/login/device');
    h.setConfigured(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.finish).not.toHaveBeenCalled();
    await h.flow.action({ type: 'confirm' });
    expect(h.ledger).toHaveBeenCalledWith('identity.select', {
      provider: 'github',
      externalUserId: '17',
    });
    expect(h.finish).toHaveBeenCalledWith({
      kind: 'ready',
      prepared: {
        attempt: h.attempt,
        identity: github,
        login: 'person',
        invitation: { scope: 'workspace', pinIdentity: github },
        local: h.local,
        allowed: expect.any(Function),
      },
    });
    expect(h.ledger.mock.calls.every(([method]) => method.startsWith('identity.'))).toBe(true);
  });
  it('pins GitLab instance and account even when GitHub is the default and both are connected', async () => {
    const h = harness({ scope: 'host', pinIdentity: gitlab });
    h.setConfigured(true);
    await h.flow.action(enabled);
    expect(h.ledger.mock.calls).toEqual([
      ['identity.authStatus', { provider: 'gitlab', host: 'gitlab.example:8443' }],
      ['identity.getUser', { provider: 'gitlab', host: 'gitlab.example:8443' }],
    ]);
    await h.flow.action({ type: 'choose', target: github });
    expect(h.flow.snapshot().error).toBe('identity-mismatch');
    expect(h.ledger).not.toHaveBeenCalledWith('identity.select', expect.anything());
  });
  it.each([null, undefined])(
    'preserves pin metadata %s and its documented default',
    async (pinIdentity) => {
      const request: CollaborationRequest = {
        scope: 'workspace',
        ...(pinIdentity === undefined ? {} : { pinIdentity }),
      };
      const h = harness(request);
      h.setDefault(gitlab);
      await h.flow.action(enabled);
      expect(h.flow.snapshot().target.provider).toBe(pinIdentity === null ? 'gitlab' : 'github');
      expect(h.flow.snapshot().request).toEqual(request);
    },
  );
  it('refuses malformed pins instead of treating them as unpinned', async () => {
    const h = harness({
      scope: 'host',
      pinIdentity: { ...gitlab, host: 'https://gitlab.com/path' },
    });
    await h.flow.action(enabled);
    expect(h.flow.snapshot().error).toBe('identity-mismatch');
    expect(h.ledger).not.toHaveBeenCalled();
  });
  it('wrong account is visible and cannot be selected; retry retains the pin', async () => {
    const h = harness();
    h.setConfigured(true);
    h.setId('18');
    await h.flow.action(enabled);
    expect(h.flow.snapshot()).toMatchObject({
      phase: 'error',
      error: 'identity-mismatch',
      user: { id: '18' },
      request: { pinIdentity: github },
    });
    await h.flow.action({ type: 'confirm' });
    expect(h.finish).not.toHaveBeenCalled();
    h.setId('17');
    await h.flow.action({ type: 'refresh' });
    await h.flow.action({ type: 'confirm' });
    expect(h.finish).toHaveBeenCalledOnce();
  });
  it('requires fresh consent after an account changes during confirmation', async () => {
    const h = harness({ scope: 'settings' });
    h.setConfigured(true);
    await h.flow.action(enabled);
    h.setId('18');
    await h.flow.action({ type: 'confirm' });
    expect(h.flow.snapshot().error).toBe('identity-mismatch');
    expect(h.ledger.mock.calls.some(([m]) => m === 'identity.select')).toBe(false);
  });
  it.each([[['repo', 'workflow']], [null], [['repo', 'workflow', 'gist']]])(
    'reports actual scopes %j without claiming a reduced grant',
    async (grants) => {
      const h = harness();
      h.setConfigured(true);
      h.setGranted(grants);
      await h.flow.action(enabled);
      expect(h.flow.snapshot().grantedScopes).toEqual(grants);
      expect(h.flow.snapshot().requestedScopes).toEqual(['gist']);
      if (grants?.includes('gist') === false) expect(h.flow.snapshot().error).toBe('scope-missing');
      else expect(h.flow.snapshot().phase).toBe('account');
    },
  );
  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])('combines Multiplayer=%s and GitLab=%s', async (multiplayer, gitlabEnabled) => {
    const h = harness({ scope: 'host', pinIdentity: gitlab });
    await h.flow.action({ type: 'policy', policy: { multiplayer, gitlab: gitlabEnabled } });
    expect(h.ledger.mock.calls.length > 0).toBe(multiplayer && gitlabEnabled);
    expect(h.flow.snapshot().request.pinIdentity).toEqual(gitlab);
  });
  it.each(['multiplayer', 'gitlab'] as const)(
    'disabling %s cancels only the local collaboration flow',
    async (flag) => {
      const h = harness({ scope: 'host', pinIdentity: gitlab });
      await h.flow.action(enabled);
      await h.flow.action({ type: 'connect' });
      await h.flow.action({
        type: 'policy',
        policy: { multiplayer: true, gitlab: true, [flag]: false },
      });
      await vi.advanceTimersByTimeAsync(10000);
      expect(h.ledger).toHaveBeenLastCalledWith('identity.cancelAuth', {
        provider: 'gitlab',
        host: 'gitlab.example:8443',
        flowId: 'flow-1',
      });
      expect(h.finish).toHaveBeenCalledWith({
        kind: 'cancelled',
        request: { scope: 'host', pinIdentity: gitlab },
        selection: { target: { provider: 'gitlab', host: gitlab.host } },
      });
      expect(
        h.ledger.mock.calls.some(([m]) => /revoke|settings|sourceControl\.connect/.test(m)),
      ).toBe(false);
    },
  );
  it.each([false, true])(
    'late startup after cancellation respects newer sign-in=%s',
    async (newer) => {
      const h = harness();
      await h.flow.action(enabled);
      const delayed = Promise.withResolvers<any>();
      h.ledger.mockImplementationOnce(() => delayed.promise);
      const pending = h.flow.action({ type: 'connect' });
      await vi.waitFor(() =>
        expect(h.ledger).toHaveBeenCalledWith('identity.connect', {
          provider: 'github',
          method: 'device',
        }),
      );
      h.flow.cancel();
      h.setLatest(!newer);
      delayed.resolve({ purpose: 'collaboration', flowId: 'late-flow' });
      await pending;
      expect(h.ledger.mock.calls.some(([m]) => m === 'identity.cancelAuth')).toBe(!newer);
      expect(h.finish).toHaveBeenCalledTimes(1);
    },
  );
  it('does not act on a replacement local connection or the remote window account', async () => {
    const h = harness();
    h.setConfigured(true);
    await h.flow.action(enabled);
    h.setCurrent(false);
    const calls = h.ledger.mock.calls.length;
    await h.flow.action({ type: 'confirm' });
    expect(h.ledger).toHaveBeenCalledTimes(calls);
    expect(h.flow.snapshot().error).toBe('local-connection-changed');
  });
  it('an old local daemon offers upgrade with no repository fallback', async () => {
    const h = harness();
    h.local.supported = false;
    await h.flow.action(enabled);
    await h.flow.action({ type: 'connect' });
    expect(h.flow.snapshot().error).toBe('upgrade-required');
    expect(h.ledger).not.toHaveBeenCalled();
  });
  it('PATs never enter snapshots, and provider error details remain private', async () => {
    const h = harness({ scope: 'host', pinIdentity: gitlab });
    await h.flow.action(enabled);
    h.ledger.mockRejectedValueOnce({
      data: { code: 'source-control-unauthorized', token: 'PAT-secret' },
      message: 'PAT-secret',
    });
    await h.flow.action({ type: 'connect', token: 'PAT-secret' });
    expect(h.ledger).toHaveBeenLastCalledWith('identity.connect', {
      provider: 'gitlab',
      host: gitlab.host,
      method: 'pat',
      token: 'PAT-secret',
    });
    expect(JSON.stringify(h.views)).not.toContain('PAT-secret');
    expect(h.flow.snapshot().error).toBe('sign-in-failed');
  });
  it('prepares and deletes proof through the captured local purpose and exact stable identity', async () => {
    const h = harness();
    const client = new CollaborationIdentityClient(h.local);
    const prepared = {
      attempt: h.attempt,
      identity: github,
      login: 'person',
      invitation: { scope: 'workspace' as const },
      local: h.local,
      allowed: () => true,
    };
    await client.createProof(prepared, 'challenge', 'shared A');
    await client.deleteProof(github, 'proof-1');
    expect(h.ledger.mock.calls).toEqual([
      [
        'sourceControl.identityProof.create',
        {
          provider: 'github',
          purpose: 'collaboration',
          expectedIdentity: github,
          nonce: 'challenge',
          hostLabel: 'shared A',
        },
      ],
      [
        'sourceControl.identityProof.delete',
        { provider: 'github', purpose: 'collaboration', proofId: 'proof-1' },
      ],
    ]);
  });
  it('stale selection cannot resume after the invitation target or metadata changes', async () => {
    const h = harness();
    h.setConfigured(true);
    await h.flow.action(enabled);
    const selecting = Promise.withResolvers<any>();
    const original = h.ledger.getMockImplementation()!;
    h.ledger.mockImplementation((method, params) =>
      method === 'identity.select' ? selecting.promise : original(method, params),
    );
    const pending = h.flow.action({ type: 'confirm' });
    await vi.waitFor(() =>
      expect(h.ledger).toHaveBeenCalledWith('identity.select', {
        provider: 'github',
        externalUserId: '17',
      }),
    );
    h.setAttemptCurrent(false);
    selecting.resolve({ principal: { identity: github } });
    await pending;
    expect(h.finish).toHaveBeenCalledExactlyOnceWith({
      kind: 'cancelled',
      request: { scope: 'workspace', pinIdentity: github },
      selection: { target: { provider: 'github', host: 'github.com' }, displayedAccountId: '17' },
    });
  });
  it('retry waits for scoped cancellation before starting a replacement flow', async () => {
    const h = harness();
    await h.flow.action(enabled);
    await h.flow.action({ type: 'connect' });
    const cancelling = Promise.withResolvers<any>();
    h.ledger.mockImplementationOnce(() => cancelling.promise);
    const pending = h.flow.action({ type: 'connect' });
    expect(h.ledger.mock.calls.filter(([method]) => method === 'identity.connect')).toHaveLength(1);
    cancelling.resolve({ ok: true, cancelled: true });
    await pending;
    expect(h.ledger.mock.calls.slice(-2)).toEqual([
      ['identity.cancelAuth', { provider: 'github', flowId: 'flow-1' }],
      ['identity.connect', { provider: 'github', method: 'device' }],
    ]);
  });
  it.each(['denied', 'expired', 'error'])(
    'a %s grant remains retryable without selecting or revoking credentials',
    async (status) => {
      const h = harness();
      await h.flow.action(enabled);
      await h.flow.action({ type: 'connect' });
      h.ledger.mockResolvedValueOnce({
        purpose: 'collaboration',
        provider: 'github',
        host: 'github.com',
        isConfigured: true,
        requestedScopes: ['gist'],
        grantedScopes: ['gist'],
        deviceFlow: { status },
      });
      await vi.advanceTimersByTimeAsync(2000);
      expect(h.flow.snapshot().error).toBe('sign-in-failed');
      expect(h.finish).not.toHaveBeenCalled();
      await h.flow.action({ type: 'connect' });
      expect(h.flow.snapshot().phase).toBe('device');
      expect(h.ledger.mock.calls.some(([method]) => /select|revoke|settings/.test(method))).toBe(
        false,
      );
    },
  );
  it.each([
    'https://evil.example/device',
    'file:///tmp/device',
    'https://user:password@github.com/device',
  ])('rejects verification address %s without opening it', async (verificationUri) => {
    const h = harness();
    await h.flow.action(enabled);
    h.ledger.mockResolvedValueOnce({
      purpose: 'collaboration',
      flowId: 'flow-1',
      userCode: 'CODE',
      verificationUri,
      expiresIn: 600,
    });
    await h.flow.action({ type: 'connect' });
    await h.flow.action({ type: 'open-browser' });
    expect(h.flow.snapshot().error).toBe('sign-in-failed');
    expect(h.openBrowser).not.toHaveBeenCalled();
    expect(h.ledger).toHaveBeenCalledWith('identity.cancelAuth', {
      provider: 'github',
      flowId: 'flow-1',
    });
  });
  it('GitLab device support refusal retains the selected instance for PAT recovery', async () => {
    const h = harness({ scope: 'host', pinIdentity: gitlab });
    await h.flow.action(enabled);
    h.ledger.mockRejectedValueOnce({ data: { code: 'device-grant-unsupported' } });
    await h.flow.action({ type: 'connect' });
    expect(h.flow.snapshot()).toMatchObject({ error: 'device-grant-unsupported', target: gitlab });
    h.setConfigured(true);
    h.ledger.mockResolvedValueOnce({ purpose: 'collaboration', ok: true });
    await h.flow.action({ type: 'connect', token: 'PAT-fixture' });
    expect(h.flow.snapshot().phase).toBe('account');
    expect(h.finish).not.toHaveBeenCalled();
  });
  it('a late connect completion cannot cancel the same resident flow adopted by a newer connect', async () => {
    const h = harness();
    await h.flow.action(enabled);
    const old = Promise.withResolvers<any>();
    h.ledger.mockImplementationOnce(() => old.promise);
    const oldConnect = h.flow.action({ type: 'connect' });
    await vi.waitFor(() =>
      expect(h.ledger).toHaveBeenCalledWith('identity.connect', {
        provider: 'github',
        method: 'device',
      }),
    );
    await h.flow.action({ type: 'connect' });
    old.resolve({
      purpose: 'collaboration',
      flowId: 'flow-1',
      userCode: 'CODE',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 600,
    });
    await oldConnect;
    expect(h.ledger.mock.calls.some(([method]) => method === 'identity.cancelAuth')).toBe(false);
    expect(h.flow.snapshot().phase).toBe('device');
    h.flow.cancel();
    expect(h.ledger).toHaveBeenLastCalledWith('identity.cancelAuth', {
      provider: 'github',
      flowId: 'flow-1',
    });
  });
  it('an expired pending flow does not reuse a previously configured account as a completed sign-in', async () => {
    const h = harness();
    h.setConfigured(true);
    await h.flow.action(enabled);
    h.ledger.mockResolvedValueOnce({
      purpose: 'collaboration',
      flowId: 'flow-1',
      userCode: 'CODE',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 1,
      interval: 2,
    });
    await h.flow.action({ type: 'connect' });
    h.ledger.mockResolvedValueOnce({
      purpose: 'collaboration',
      provider: 'github',
      host: 'github.com',
      isConfigured: true,
      requestedScopes: ['gist'],
      grantedScopes: ['gist'],
      deviceFlow: { status: 'pending' },
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.flow.snapshot().phase).toBe('error');
    expect(h.finish).not.toHaveBeenCalled();
  });
  it('cancel preserves an unpinned invitation and its explicitly chosen GitLab instance', async () => {
    const h = harness({ scope: 'workspace', pinIdentity: null });
    await h.flow.action(enabled);
    await h.flow.action({
      type: 'choose',
      target: { provider: 'gitlab', host: 'team.gitlab.example' },
    });
    h.flow.cancel();
    expect(h.finish).toHaveBeenCalledExactlyOnceWith({
      kind: 'cancelled',
      request: { scope: 'workspace', pinIdentity: null },
      selection: { target: { provider: 'gitlab', host: 'team.gitlab.example' } },
    });
    expect(h.ledger.mock.calls.some(([method]) => /select|revoke|settings/.test(method))).toBe(
      false,
    );
  });
});
