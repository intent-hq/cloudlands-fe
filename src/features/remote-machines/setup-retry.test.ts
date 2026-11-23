/**
 * Retrying a remote agent's setup (PROTOCOL `methods/nodes.md` "Retrying a
 * remote agent's setup"): the capability gate, the `agent.retrySetup` request
 * and how each documented refusal resolves.
 */
import { describe, expect, it, vi } from 'vitest';

const ui = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: ui }));
import { BackendError } from '$lib/client/live/backend-transport-types';
import { parsePrincipalSnapshot } from '$shared/types/principal';
import {
  SETUP_RETRY_REFUSAL_CODES,
  canRetrySetup,
  retryRemoteSetup,
  notifySetupRetryRefused,
  type SetupRetryRequest,
} from './setup-retry';

const PARAMS = { workspaceId: 'ws-1', agentId: 'agent-1' };

/** The refusal toast's description for an outcome. */
function toastText(outcome: Awaited<ReturnType<typeof retryRemoteSetup>>): string {
  if (outcome.ok) throw new Error('expected a refusal');
  ui.error.mockClear();
  notifySetupRetryRefused('Mac mini', outcome);
  const [title, options] = ui.error.mock.calls[0] as [string, { description: string }];
  expect(title).toContain('Mac mini');
  return options.description;
}

describe('canRetrySetup', () => {
  it('offers a retry only for a failed setup on a backend that advertises it', () => {
    expect(canRetrySetup(true, { state: 'failed' })).toBe(true);
    expect(canRetrySetup(false, { state: 'failed' })).toBe(false);
    for (const state of ['pending', 'running', 'completed', 'skipped'] as const)
      expect(canRetrySetup(true, { state })).toBe(false);
    expect(canRetrySetup(true, undefined)).toBe(false);
  });

  it('reads remoteSetupRetry from the hello only when it is exactly 1', () => {
    const snapshot = (remoteSetupRetry: unknown) =>
      parsePrincipalSnapshot(
        { server: { capabilities: { remoteSetupRetry } } },
        { id: 'p-1', isAdministrator: true, login: null, displayName: null, avatarUrl: null },
      )?.capabilities.remoteSetupRetry;
    expect(snapshot(1)).toBe(1);
    for (const value of [true, '1', 2, 0, null, undefined]) expect(snapshot(value)).toBeUndefined();
  });
});

describe('retryRemoteSetup', () => {
  it('sends agent.retrySetup with the workspace and agent and returns the running setup', async () => {
    const setup = { state: 'running', startedAt: '2026-11-23T09:00:00Z' };
    const request = vi.fn(async () => ({ agentId: 'agent-1', setup }));
    const typed = request as unknown as SetupRetryRequest;
    await expect(retryRemoteSetup(PARAMS, typed)).resolves.toEqual({ ok: true, setup });
    expect(request).toHaveBeenCalledExactlyOnceWith('agent.retrySetup', PARAMS);
  });

  it.each(SETUP_RETRY_REFUSAL_CODES.filter((code) => code !== 'machine-unreachable'))(
    'resolves the -32602 refusal %s with the daemon message',
    async (code) => {
      const message = `refused: ${code}`;
      const request = vi.fn(async () => {
        throw new BackendError({ code, rpcCode: -32602, data: { code }, message });
      });
      const outcome = await retryRemoteSetup(PARAMS, request);
      expect(outcome).toEqual({ ok: false, code, message });
      expect(toastText(outcome)).toBe(message);
    },
  );

  it('resolves -32603 machine-unreachable as a refusal', async () => {
    const request = vi.fn(async () => {
      throw new BackendError({
        code: 'machine-unreachable',
        rpcCode: -32603,
        data: { code: 'machine-unreachable' },
        message: 'Mac mini did not answer',
      });
    });
    await expect(retryRemoteSetup(PARAMS, request)).resolves.toMatchObject({
      ok: false,
      code: 'machine-unreachable',
    });
  });

  it('treats -32601 from an older daemon as unsupported, with the app’s own message', async () => {
    const request = vi.fn(async () => {
      throw new BackendError({ code: 'METHOD_NOT_FOUND', rpcCode: -32601, message: 'nope' });
    });
    const outcome = await retryRemoteSetup(PARAMS, request);
    expect(outcome).toMatchObject({ ok: false, code: 'unsupported' });
    const text = toastText(outcome);
    expect(text).not.toBe('nope');
    expect(text.length).toBeGreaterThan(0);
  });

  it('resolves an unknown failure without a message to a fallback text', async () => {
    const request = vi.fn(async () => {
      throw new Error('');
    });
    const outcome = await retryRemoteSetup(PARAMS, request);
    expect(outcome).toMatchObject({ ok: false, code: 'unknown' });
    expect(toastText(outcome).length).toBeGreaterThan(0);
  });
});
